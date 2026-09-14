const path = require('path');
// Try multiple paths for dotenv in different deployment environments
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config(); // Fallback to default .env location

const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const router = require('./routes/index');

// Konfigurasi CORS - Dynamic origins dari environment variables
// Origin dinormalisasi (lowercase, tanpa trailing slash, tanpa path) supaya
// nilai env seperti "https://admin.example.com/" tetap cocok dengan header
// Origin dari browser, yang selalu berbentuk scheme://host[:port].
const normalizeOrigin = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  try {
    const { protocol, host } = new URL(raw);
    return `${protocol}//${host}`.toLowerCase();
  } catch {
    console.warn(`⚠️  Invalid CORS origin ignored: ${raw}`);
    return null;
  }
};

const getCorsOrigins = () => {
  const origins = [];

  // Development origins (hanya jika NODE_ENV development)
  if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
    origins.push('http://localhost:3000', 'http://localhost:8080', 'http://localhost:8081');
  }

  // Production origins dari environment variables
  origins.push(process.env.WEB_APP_URL, process.env.WEB_ADMIN_URL, process.env.API_UPLOAD_URL);

  const normalized = [...new Set(origins.map(normalizeOrigin).filter(Boolean))];

  // Fallback untuk production jika env vars tidak ada
  if (process.env.NODE_ENV === 'production' && normalized.length === 0) {
    console.warn('⚠️  No CORS origins configured! Please set WEB_APP_URL and WEB_ADMIN_URL environment variables.');
  } else {
    console.info(`CORS allowed origins: ${normalized.join(', ')}`);
  }

  return normalized;
};

const corsOptions = {
  origin: getCorsOrigins(),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true
};

const app = express();

const swaggerOption = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API IOM (Latest)',
      version: '1.0.0',
      description: 'API Documentation for IOM ITB',
    },
    servers: [
      {
        url: process.env.BASE_URL,
        description: 'Production Server',
      },
    ],
  },
  apis: [
    path.join(__dirname, 'routes/swagger/*.js'),
    path.join(__dirname, '../openapi.yml'),
  ],
};

const swaggerSpec = swaggerJsDoc(swaggerOption);

// Explicit route for openapi.json BEFORE swagger middleware
app.get('/api/openapi.json', (req, res) => {
  res.json(swaggerSpec);
});

app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customSiteTitle: 'IOM ITB API Documentation',
  }),
);

app.use(morgan('dev'));
// app.use(helmet());

// Tally webhook needs raw body for signature verification.
app.use('/webhooks/tally', express.raw({ type: 'application/json' }));

// Manual CORS implementation
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = corsOptions.origin;
  const requestOrigin = normalizeOrigin(origin);
  const isAllowed = !!requestOrigin && allowedOrigins.includes(requestOrigin);

  // Respons berbeda per origin, jadi proxy/CDN tidak boleh menyatukan cache-nya.
  res.header('Vary', 'Origin');

  if (isAllowed) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Selected-Role');
    res.header('Access-Control-Max-Age', '600');
  } else if (origin) {
    console.warn(`CORS blocked origin: ${origin} (allowed: ${allowedOrigins.join(', ') || 'none'})`);
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(isAllowed ? 204 : 403);
    return;
  }

  next();
});

app.use(express.json());

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Custom static middleware - exclude /api routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  express.static(path.join(__dirname, ''))(req, res, next);
});

app.use(router);


app.get('/', (req, res) => {
  res.json({
    message: 'SELAMAT DATANG DI API IOM',
  });
});

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;

  res.status(status).json({
    status,
    message: err.message || 'Internal Server Error',
  });
});

// forgotPasswordJob.start();
const { broadcastJob } = require('./utils/cron');
broadcastJob.start();

// const endpoints = expressListEndpoints(app);
// console.log(endpoints);

module.exports = app;
