# Project Overview
1.  **Brief description**: A Web3 security suite with a browser extension for real-time threat detection and a Next.js web app serving as the admin console and API.
2.  **Summary of key features**: on-page address analysis and labelling, and a web dashboard for managing labels, settings and admin console for the whole application.
# Core Functionalities
### Web Dashboard & API & Websocket
Provides API endpoints and websocket connection for the extension, user account management, and a custom address labeling.
### Browser Extension
Manages crypto addresses and Scans web pages to highlight them..
# Doc (Documentation)

1.  **Required packages and libraries**:
    *   `next`, `react`, `react-dom`: Core libraries for the web application.
    *   `mongodb`: For all database interactions within the Next.js API routes.
    *   `@reduxjs/toolkit`, `react-redux`: For managing complex application state, especially for the user dashboard and settings.
    *   `SWR` or `React Query`: For efficient data fetching, caching, and state synchronization between the frontend and the API.
    *   `blocknative/sdk` (or similar): A third-party SDK to integrate transaction simulation capabilities into the browser extension.
    *   `web3.js` / `ethers.js`: For interacting with blockchain data within the extension and potentially on the backend for validation tasks.

2.  **Code examples**:
    *   **Next.js API for Submitting a Suspicious Domain**:
        ```javascript:pages/api/reports/submit.js
        // pages/api/reports/submit.js
        import { saveReport } from '../../../lib/db';
        import { verifyUserToken } from '../../../lib/auth'; // Assume JWT auth

        export default async function handler(req, res) {
          if (req.method !== 'POST') {
            return res.status(405).end();
          }

          const user = await verifyUserToken(req);
          if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
          }

          const { domain, reason } = req.body;
          if (!domain) {
            return res.status(400).json({ error: 'Domain is required' });
          }

          // Save the report to the database for admin review
          await saveReport({ domain, reason, submittedBy: user.id });

          res.status(202).json({ message: 'Report received and pending review.' });
        }
        ```
    *   **React Component for the Reporting Form**:
        ```javascript:components/ReportForm.js
        // components/ReportForm.js
        import { useState } from 'react';

        export default function ReportForm() {
          const [domain, setDomain] = useState('');
          const [message, setMessage] = useState('');

          const handleSubmit = async (e) => {
            e.preventDefault();
            const response = await fetch('/api/reports/submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ domain }),
            });
            const data = await response.json();
            setMessage(data.message || data.error);
          };

          return (
            <form onSubmit={handleSubmit}>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="suspicious-domain.com"
              />
              <button type="submit">Report</button>
              {message && <p>{message}</p>}
            </form>
          );
        }
        ```
# Example file structure
```
    /
    |-- components/         // UI components for the web app
    |   `-- forms/
    |-- extension/          // Browser extension source code
    |   |-- content-scripts/
    |   |-- background/
    |   `-- manifest.json
    |-- hooks/              // Custom React hooks (e.g., useUser)
    |-- lib/                // Shared libraries
    |   |-- api/            // Backend helpers
    |   |-- auth.js         // Auth logic (cookies, tokens)
    |   `-- db.js           // Database connection & queries
    |-- pages/              // Next.js pages and API routes
    |   |-- api/            // The backend API
    |   |   |-- auth/       // Login, logout, signup
    |   |   |-- reports/    // Submit and view reports
    |   |   `-- settings/
    |   |-- dashboard/
    |   |   `-- index.js
    |   `-- index.js        // The landing page
    |-- public/
    |-- store/              // Redux store, slices, and actions
    |   |-- slices/
    |   `-- index.js
    |-- styles/
    |-- .gitignore
    |-- next.config.js
    `-- package.json
```