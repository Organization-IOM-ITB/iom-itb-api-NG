const { StatusCodes } = require('http-status-codes');
const BaseResponse = require('../schemas/responses/BaseResponse');
const DataTable = require('../schemas/responses/DataTable');
const CreateActivity = require('../services/activities/createActivities');
const GetActivities = require('../services/activities/getActivities');
const UpdateActivity = require('../services/activities/updateActivities');
const DeleteActivity = require('../services/activities/deleteActivities');
const { Activities, Tags } = require('../models');
const { Op } = require('sequelize');

const GetActivityBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const activity = await GetActivities({ slug, status: 'published' });

    if (!activity || activity.message) {
      return res.status(StatusCodes.NOT_FOUND).json(new BaseResponse({
        status: StatusCodes.NOT_FOUND,
        message: 'Activity tidak ditemukan',
      }));
    }

    res.status(StatusCodes.OK).json(new BaseResponse({
      status: StatusCodes.OK,
      message: 'Activity ditemukan',
      data: activity,
    }));
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({
      status,
      message: error.message || 'Terjadi kesalahan saat mengambil activity',
    }));
  }
};

const GetAllActivities = async (req, res) => {
  try {
    const { search, contributor, page = 1, limit = 10, sort } = req.query;
    const pageNumber = parseInt(page);
    const pageLimit = Math.min(parseInt(limit), 50);
    const activities = await GetActivities({
      search,
      contributor,
      page: pageNumber,
      limit: pageLimit,
      status: 'published',
      sort,
    });

    const totalEntries = activities.total;
    const totalPages = Math.ceil(totalEntries / pageLimit);
    const start = (pageNumber - 1) * pageLimit + 1;
    const end = Math.min(pageNumber * pageLimit, totalEntries);

    res.status(StatusCodes.OK).json({
      data: new DataTable(activities.data)?.data,
      pagination: { currentPage: pageNumber, totalPages, start, end, totalEntries },
    });
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({ status, message: error.message }));
  }
};

const GetAllActivitiesAdmin = async (req, res) => {
  try {
    const { search, contributor, page = 1, limit = 10, status, sort } = req.query;
    const pageNumber = parseInt(page);
    const pageLimit = Math.min(parseInt(limit), 100);
    const activities = await GetActivities({
      search,
      contributor,
      page: pageNumber,
      limit: pageLimit,
      status,
      sort,
    });

    const totalEntries = activities.total;
    const totalPages = Math.ceil(totalEntries / pageLimit);
    const start = (pageNumber - 1) * pageLimit + 1;
    const end = Math.min(pageNumber * pageLimit, totalEntries);

    res.status(StatusCodes.OK).json({
      data: new DataTable(activities.data)?.data,
      pagination: { currentPage: pageNumber, totalPages, start, end, totalEntries },
    });
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({ status, message: error.message }));
  }
};

const GetActivityCounts = async (req, res) => {
  try {
    const total = await Activities.count();
    const draft = await Activities.count({ where: { status: 'draft' } });
    const published = await Activities.count({ where: { status: 'published' } });
    res.status(StatusCodes.OK).json(new BaseResponse({
      status: StatusCodes.OK,
      message: 'OK',
      data: { total, draft, published }
    }));
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({ status, message: error.message }));
  }
};

const GetAllTags = async (req, res) => {
  try {
    const { search } = req.query;
    const where = search ? { name: { [Op.like]: `%${search}%` } } : {};
    const tags = await Tags.findAll({ where, order: [['name', 'ASC']] });
    res.status(StatusCodes.OK).json(new BaseResponse({
      status: StatusCodes.OK,
      message: 'OK',
      data: tags,
    }));
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({ status, message: error.message }));
  }
};

const normalizeContributorList = (contributors) => {
  if (Array.isArray(contributors)) return contributors;
  if (typeof contributors === 'string') {
    try {
      const parsed = JSON.parse(contributors);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const GetAllContributors = async (req, res) => {
  try {
    const { search = '', limit = 8 } = req.query;
    const query = String(search).trim().toLowerCase();
    const maxResults = Math.min(parseInt(limit) || 8, 20);
    const contributorsByKey = new Map();

    const activities = await Activities.findAll({
      attributes: ['contributors'],
      where: {
        contributors: { [Op.ne]: null },
      },
      order: [['updatedAt', 'DESC']],
    });

    activities.forEach((activity) => {
      normalizeContributorList(activity.contributors).forEach((value) => {
        const name = String(value).trim().replace(/\s+/g, ' ');
        if (!name) return;
        if (query && !name.toLowerCase().includes(query)) return;

        const key = name.toLowerCase();
        if (!contributorsByKey.has(key)) contributorsByKey.set(key, name);
      });
    });

    const contributors = Array.from(contributorsByKey.values())
      .slice(0, maxResults)
      .map(name => ({ name }));

    res.status(StatusCodes.OK).json(new BaseResponse({
      status: StatusCodes.OK,
      message: 'OK',
      data: contributors,
    }));
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({ status, message: error.message }));
  }
};

const CreateNewActivity = async (req, res) => {
  try {
    const { body } = req;
    const newActivity = await CreateActivity(body);

    res.status(StatusCodes.CREATED).json(new BaseResponse({
      status: StatusCodes.CREATED,
      message: 'Activity created successfully',
      data: newActivity,
    }));
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({
      status,
      message: error.message || 'Failed to create activity',
    }));
  }
};

const UpdateActivityById = async (req, res) => {
  try {
    const { id } = req.params;
    const { body } = req;
    
    const updatedActivity = await UpdateActivity(id, body);

    res.status(StatusCodes.OK).json(new BaseResponse({
      status: StatusCodes.OK,
      message: 'Activity berhasil diperbarui',
      data: updatedActivity,
    }));
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({ status, message: error.message }));
  }
};

const DeleteActivityById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await DeleteActivity(id);
    res.status(StatusCodes.OK).json(new BaseResponse({
      status: StatusCodes.OK,
      message: result.message,
    }));
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({ status, message: error.message }));
  }
};

const GetActivityById = async (req, res) => {
  try {
    const { id } = req.params;
    const activity = await GetActivities({ id: parseInt(id) });
    if (!activity || activity.message) {
      return res.status(StatusCodes.NOT_FOUND).json(new BaseResponse({
        status: StatusCodes.NOT_FOUND,
        message: 'Activity tidak ditemukan',
      }));
    }
    res.status(StatusCodes.OK).json(new BaseResponse({
      status: StatusCodes.OK,
      message: 'Activity ditemukan',
      data: activity,
    }));
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({ status, message: error.message }));
  }
};

module.exports = {
  GetActivityBySlug,
  GetAllActivities,
  GetAllActivitiesAdmin,
  GetActivityById,
  GetActivityCounts,
  GetAllTags,
  GetAllContributors,
  CreateNewActivity,
  UpdateActivityById,
  DeleteActivityById,
};
