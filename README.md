# SmartGoal App

SmartGoal App is an Android mobile application that helps users create, manage, and complete personal goals. The app is designed as a goal-tracking service where users can break large goals into smaller steps, track their progress, upload proof of completion, and stay motivated through scores, notifications, and smart goal support.

The project is built with **React Native**, **Expo**, **TypeScript**, **Express.js**, **Prisma**, **PostgreSQL**, **AWS S3**, and **Docker**.

## About the Service

SmartGoal App helps users turn their goals into clear and manageable action plans.

Instead of only writing a goal such as:

```txt
I want to learn programming.
```

the app helps users manage the goal through steps, progress tracking, reminders, and completion proof.

The main purpose of the app is to support users in:

* setting personal goals
* breaking goals into smaller tasks
* tracking goal progress
* staying motivated
* uploading proof when a goal step is completed
* receiving notifications and reminders
* reviewing goal history and progress

## Main Features

### User Accounts

Users can create an account and log in securely.

The backend uses JWT authentication to identify logged-in users. Passwords are protected using Bcrypt before they are stored in the database.

### Goal Management

Users can create and manage personal goals.

Each goal can include information such as:

* goal title
* description
* target date
* progress status
* related steps

### Goal Steps

Large goals can be divided into smaller steps.

For example:

```txt
Goal: Learn React Native

Step 1: Learn React basics
Step 2: Learn React Native components
Step 3: Build a simple screen
Step 4: Connect the app to an API
Step 5: Build a final project
```

This makes the goal easier to follow and complete.

### Progress Tracking

Users can track their progress as they complete goal steps.

The app can store completed steps, goal status, and progress history.

### Proof Upload

Users can upload proof after completing a goal or a goal step.

For example, a user may upload:

* an image
* a screenshot
* a document
* other proof of completion

Uploaded files are stored using AWS S3. The mobile app sends the file to the backend API, and the backend uploads it to the app’s AWS S3 storage.

### Smart Goal Support

The app includes smart goal-related features to help users create better goals and requirements.

This can help users make their goals more specific, realistic, and easier to follow.

### Notifications

The app supports notifications to remind users about their goals and tasks.

This helps users stay consistent and avoid forgetting their planned activities.

### Score and XP System

The app includes a scoring system to increase user motivation.

Users can gain score or XP when they complete goals or steps.

### Calendar and Events

The app includes event-related features that can help users organize goal activities by time.

## Platform Support

This project was developed and tested mainly for **Android** using **Expo**.

iOS support is not fully tested. Since the project uses React Native and Expo, iOS support may be possible with extra testing and configuration, but this project currently focuses on Android.

## Tech Stack

### Mobile App

* React Native
* Expo
* TypeScript
* React Navigation
* Expo Secure Store
* Expo File System
* Expo Image Picker
* Expo Notifications

### Backend API

* Node.js
* Express.js
* TypeScript
* Prisma ORM
* PostgreSQL
* JWT authentication
* Bcrypt password hashing
* Zod validation
* AWS S3 SDK
* Docker Compose

## How the App Works

```txt
User uses Android app
→ app sends requests to backend API
→ backend checks authentication
→ backend reads/writes data with Prisma
→ PostgreSQL stores user and goal data
→ uploaded files are stored in AWS S3
→ app shows updated goals and progress to user
```

## Backend Responsibilities

The backend API manages the main business logic of the service, including:

* user registration
* user login
* authentication with JWT
* password protection with Bcrypt
* request validation with Zod
* goal data management
* goal step management
* proof upload handling
* AWS S3 file upload
* database operations with Prisma

## Frontend Responsibilities

The mobile app provides the user interface for:

* registering and logging in
* creating goals
* viewing goals
* updating progress
* completing goal steps
* uploading proof
* receiving notifications
* checking score and progress

## Project Structure

```txt
Education-Mobile-App-RN/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma
│   ├── src/
│   │   ├── routes/
│   │   ├── schemas/
│   │   ├── utils/
│   │   ├── server.ts
│   │   └── serverFactory.ts
│   ├── docker-compose.yml
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── android/
│   ├── assets/
│   ├── src/
│   │   ├── ai/
│   │   ├── api/
│   │   ├── auth/
│   │   ├── components/
│   │   ├── config/
│   │   ├── motivation/
│   │   ├── navigation/
│   │   ├── notifications/
│   │   ├── screens/
│   │   ├── settings/
│   │   ├── theme/
│   │   └── utils/
│   ├── App.tsx
│   ├── app.json
│   ├── index.ts
│   └── package.json
```

## Backend Setup

Go to the backend folder:

```bash
cd backend
```

Install dependencies:

```bash
npm install
```

Start PostgreSQL using Docker:

```bash
docker compose up -d
```

Create a `.env` file inside the `backend` folder:

```env
DATABASE_URL="postgresql://app:app_password@localhost:5432/education_app"

PORT=3000
CORS_ORIGIN="http://localhost:19006"

JWT_ACCESS_SECRET="your_access_token_secret"
JWT_REFRESH_SECRET="your_refresh_token_secret"

AWS_REGION="your_aws_region"
AWS_ACCESS_KEY_ID="your_aws_access_key_id"
AWS_SECRET_ACCESS_KEY="your_aws_secret_access_key"
AWS_S3_BUCKET="your_s3_bucket_name"
```

Generate Prisma client:

```bash
npm run prisma:generate
```

Run database migrations:

```bash
npm run prisma:migrate
```

Start the backend server:

```bash
npm run dev
```

The backend should run at:

```txt
http://localhost:3000
```

## Frontend Setup

Go to the frontend folder:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Start Expo:

```bash
npm start
```

Run the Android app:

```bash
npm run android
```

For Android emulator, the backend API URL may need to use:

```txt
http://10.0.2.2:3000
```

For a physical Android device, replace `localhost` with your computer’s local network IP address.

Example:

```txt
http://192.168.1.10:3000
```

## Environment Variables

### Database

```env
DATABASE_URL
```

Used by Prisma to connect the backend to PostgreSQL.

### Authentication

```env
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
```

Used by the backend to create and verify login tokens.

JWT helps the backend know which user is logged in.

### File Storage

```env
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_S3_BUCKET
```

Used by the backend to upload user proof files to AWS S3.

These values belong only on the backend server. Users do not provide these values, and they should not be placed inside the mobile app.

## Database Models

The backend uses Prisma with PostgreSQL.

Main models include:

* User
* Goal
* GoalStep
* GoalStepCompletion
* SmartGoalProofAttempt
* ScoreHistoryPoint
* UserNotification
* Event
* AppSetting
* LeaderboardTop

## Learning Outcomes

This project demonstrates experience with:

* building an Android mobile app with React Native and Expo
* creating a backend API with Express.js and TypeScript
* designing a goal-tracking service
* using Prisma ORM with PostgreSQL
* implementing user authentication with JWT
* protecting passwords with Bcrypt
* validating request data with Zod
* uploading files to AWS S3
* using Docker Compose for local database setup
* connecting a mobile app with a backend service

## Author

Vu Ha Tuyen

GitHub: https://github.com/vhatuyen04
