# Vuducom Instagram DM & Comment Automation Software

Vuducom DM Automation is a powerful, cross-platform desktop application designed to automate Instagram direct messages (DMs) and post comments. Built using **Electron**, **Next.js**, and **Playwright with Stealth**, the application simulates realistic human behavior to keep your automation sequences secure and natural.

---

## Key Features

- **DM Automation Bot**: Target specific usernames with randomized marketing messages.
- **Comment Automation Bot**: Automated post navigation and comment publishing.
- **Human-like Simulation**: Character-by-character typing emulation, mouse wiggles, scrolling patterns, and randomized timing intervals to bypass bot detection.
- **Stealth Protection**: Utilizes Playwright Stealth plugins to mask automation footprints.
- **Local SQLite Database**: Fully persistent campaign queues, user profiles, and session storage.
- **Cloud DB Support**: Optional cloud-hosted PostgreSQL database config via environment variables.
- **Action Limits & Cooldowns**: Enforce strict hourly activity limits and user-defined action delays.

---

## Technical Stack

- **Core Desktop Shell**: Electron (v29)
- **Frontend Panel**: React & Next.js (Static Export)
- **Backend API Server**: Node.js Express, TypeScript, and Prisma ORM
- **Automation Driver**: Playwright (Chromium) & Puppeteer Extra Stealth

---

## Getting Started (Development)

### Prerequisites
- Node.js (v18 or v20 recommended)
- Google Chrome installed on your machine (used by Playwright in production)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/Sreehari2710/IG-DM-Software.git
   cd IG-DM-Software
   ```
2. Install root dependencies:
   ```bash
   npm install
   ```
3. Install backend and frontend dependencies:
   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   cd ..
   ```
4. Generate the Prisma database client:
   ```bash
   cd backend
   npx prisma generate
   cd ..
   ```

### Running the App Locally
Run the concurrent development server (starts Next.js, Express, and launches Electron in dev-mode):
```bash
npm run dev
```

---

## Building and Packaging Installers

Installers are packaged in the cloud using **GitHub Actions** workflows. However, you can also compile them locally.

### Cloud Builds (Recommended)
Simply push your changes to your GitHub repository on `main` or `master` branches:
- The GitHub workflow automatically triggers, compiling both macOS `.dmg` and Windows `.exe` installers in parallel.
- Go to the **Actions** tab on your GitHub repository, choose the completed run, and download the installers from the **Artifacts** section at the bottom.

### Local Packaging
- **Windows**:
  ```bash
  npm run dist:win
  ```
- **macOS** (Requires macOS system):
  ```bash
  npm run dist:mac
  ```

Packaged installers will be outputted to the `dist-packed/` directory.

---

## macOS Gatekeeper Bypass Instructions

When downloading and installing the macOS `.dmg` installer from a shared link (e.g. Google Drive), macOS will flag the application as unsigned. Users must follow these steps to run the application:

1. Double-click the `.dmg` file and drag **Vuducom DM Automation** to your **Applications** folder.
2. Open the **Terminal** app on your Mac.
3. Run the following command:
   ```bash
   xattr -cr "/Applications/Vuducom DM Automation.app"
   ```
4. You can now launch the application normally from Launchpad or your Applications directory!
