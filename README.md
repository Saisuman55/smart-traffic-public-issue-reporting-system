# The Civic Authority

> A civic issue reporting platform built with React, Express, MongoDB, Firebase, and NVIDIA AI.

[![CI](https://img.shields.io/badge/CI-GitHub_Actions-black?style=for-the-badge&logo=githubactions)](#)
[![React](https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript)](#)
[![MongoDB](https://img.shields.io/badge/MongoDB-Database-47A248?style=for-the-badge&logo=mongodb)](#)
[![Firebase](https://img.shields.io/badge/Firebase-Auth%20%2B%20Storage-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](#)
[![NVIDIA](https://img.shields.io/badge/NVIDIA-AI-76B900?style=for-the-badge&logo=nvidia)](#)

## Overview

The Civic Authority helps users report civic issues with photos, location data, AI-assisted validation, and status tracking. It includes a public reporting flow, live issue views, analytics, notifications, and an admin panel for moderation and operations.

## Team

| Member | Role | GitHub |
| --- | --- | --- |
| Sai Suman Sumantaray | Project Lead + Backend | [@Saisuman55](https://github.com/Saisuman55) |
| Satya | Frontend Developer | [@satyaspandanrout](https://github.com/satyaspandanrout) |
| Suvrajit | Backend Developer | [@Suvrajit14](https://github.com/Suvrajit14) |
| Rohan | Database + API Integration | [@RohanAnand-SPG](https://github.com/RohanAnand-SPG) |
| Sanjay | UI/UX Designer | [@sanjaysahooyt99-ux](https://github.com/sanjaysahooyt99-ux) |

## Tech Stack

- Frontend: React, Vite, TypeScript
- Backend: Express
- Database: MongoDB
- Auth and storage: Firebase Auth, Firebase Storage
- AI provider: NVIDIA API

## Architecture Notes

- MongoDB is the primary application database
- Firebase is retained for authentication and image storage
- AI routes are implemented in [server.ts](./server.ts)
- The frontend data wrapper remains in [src/firebase.ts](./src/firebase.ts), but it now proxies data operations through Mongo-backed API routes

## Setup

### Prerequisites

- Node.js
- MongoDB running locally or remotely
- Firebase project configured for web auth and storage
- NVIDIA API key

### Environment variables

Copy [.env.example](./.env.example) to `.env` and set real values.

Required:

- `MONGODB_URI`
- `MONGODB_DB_NAME`
- `NVIDIA_API_KEY`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`

Optional:

- `NVIDIA_TEXT_MODEL`
- `NVIDIA_MULTIMODAL_MODEL`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_FIREBASE_FIRESTORE_DATABASE_ID`
- `APP_URL`

## Local Development

```bash
npm install
npm run dev
```

App URL:

`http://localhost:3000`

## Validation

```bash
npm run lint
npm run build
```

## Project Status

This repository has been updated to:

- replace Firestore data access with MongoDB-backed API routes
- replace Gemini-based AI calls with NVIDIA API integrations
- keep Firebase for auth and storage only

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

This project is licensed under the [MIT License](./LICENSE).
