const { Activities, Tags, sequelize } = require('../../models');
const { StatusCodes } = require('http-status-codes');
const BaseError = require('../../schemas/responses/BaseError');
const sanitizeHtml = require('sanitize-html');

const sanitizeDescription = (html) => {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'strong', 'em', 'u', 's', 'blockquote',
      'ul', 'ol', 'li', 'img', 'a', 'br', 'div', 'iframe'
    ],
    allowedAttributes: {
      'img': ['src', 'alt', 'style'],
      'a': ['href', 'target', 'rel'],
      'p': ['style'],
      'h1': ['style'],
      'h2': ['style'],
      'h3': ['style'],
      'div': ['data-youtube-video'],                         
      'iframe': [                                            
        'src', 'width', 'height',
        'allowfullscreen', 'autoplay',
        'disablekbcontrols', 'enableiframeapi',
        'endtime', 'ivloadpolicy', 'loop',
        'modestbranding', 'origin', 'playlist',
        'rel', 'start', 'frameborder', 'allow'
      ],
    },
    allowedStyles: {
      '*': {
        'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/],
        'width': [/^\d+(%|px)$/],
        'height': [/.*/],
      },
    },
    allowedSchemesByTag: {
      'img': ['https', 'http'],
      'a': ['https'],
      'iframe': ['https'],              
    },
    transformTags: {
      'a': (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' }
      })
    }
  });
};

const getJakartaDateString = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const dateParts = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
};

const UpdateActivities = async (id, body) => {
  const transaction = await sequelize.transaction();

  try {
    const activity = await Activities.findByPk(id, { transaction });

    if (!activity) {
      throw new BaseError({
        status: StatusCodes.NOT_FOUND,
        message: 'Aktivitas tidak ditemukan.',
      });
    }

    const { title, date, description, url, image, status, tags, contributors } = body;

    if (!title && !date && !description && !url && image === undefined && !status && tags === undefined && contributors === undefined) {
      throw new BaseError({
        status: StatusCodes.BAD_REQUEST,
        message: 'Setidaknya salah satu field harus diisi untuk pembaruan.',
      });
    }

    if (url && url !== activity.url) {
      const existingActivity = await Activities.findOne({ where: { url } });
      if (existingActivity) {
        throw new BaseError({
          status: StatusCodes.CONFLICT,
          message: 'URL sudah digunakan. Silakan gunakan URL yang berbeda.',
        });
      }
    }

    if (tags !== undefined && tags.length > 3) {
      throw new BaseError({
        status: StatusCodes.BAD_REQUEST,
        message: 'Maksimal 3 tag per kegiatan.',
      });
    }

    const cleanDescription = description !== undefined
      ? sanitizeDescription(description)
      : activity.description;

    const nextStatus = status || activity.status;
    const nextImage = image !== undefined ? image : activity.image;
    const nextContributors = contributors !== undefined ? contributors : activity.contributors;

    if (nextStatus === 'published') {
      if (!nextImage) {
        throw new BaseError({
          status: StatusCodes.BAD_REQUEST,
          message: 'Thumbnail wajib diisi sebelum publish.',
        });
      }

      const validContributors = Array.isArray(nextContributors)
        ? nextContributors.filter(contributor => String(contributor).trim())
        : [];

      if (validContributors.length === 0) {
        throw new BaseError({
          status: StatusCodes.BAD_REQUEST,
          message: 'Minimal 1 kontributor wajib diisi sebelum publish.',
        });
      }
    }

    const shouldSetPublishDate = status === 'published' && activity.status !== 'published' && date === undefined;

    await Activities.update(
      {
        title: title || activity.title,
        image: nextImage,
        description: cleanDescription,
        date: date !== undefined ? date : shouldSetPublishDate ? getJakartaDateString() : activity.date,
        url: url !== undefined ? url : activity.url,
        status: nextStatus,
        contributors: nextContributors,
      },
      { where: { id }, transaction }
    );

    if (tags !== undefined) {
      const tagInstances = await Promise.all(
        tags.map(name => Tags.findOrCreate({ where: { name: name.trim().toLowerCase() } }))
      );
      await activity.setTags(tagInstances.map(([tag]) => tag), { transaction });
    }

    await transaction.commit();

    const result = await Activities.findOne({
      where: { id },
      include: [{ model: Tags, as: 'tags' }]
    });

    return result;
  } catch (error) {
    await transaction.rollback();
    throw new BaseError({
      status: error.status || StatusCodes.INTERNAL_SERVER_ERROR,
      message: `Gagal memperbarui aktivitas: ${error.message || error}`,
    });
  }
};

module.exports = UpdateActivities;
