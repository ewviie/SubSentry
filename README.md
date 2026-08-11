# SubSentry

**Find the subscriptions you forgot about. See what they really cost. Take back control.**

SubSentry is a subscription-management and personal-finance web app designed to help people discover recurring payments, understand their true annual cost, identify savings opportunities, and manage subscriptions from one place.

> Built to fight **subscription creep** — the collection of subscriptions that quietly accumulate over time.

---

## ✨ What SubSentry Does

SubSentry brings recurring spending into one clear dashboard.

### 🔎 Find recurring subscriptions

Import transaction data and let SubSentry analyze it for recurring payments.

Supported/import flows include:

* Bank CSV imports
* Gmail-based transaction discovery
* Plaid connection infrastructure
* TrueLayer connection infrastructure
* Apple export messaging
* Google Play-related subscription handling

The import system is designed around a provider-agnostic transaction pipeline, making it possible to add additional financial data providers without rebuilding the detection engine.

### 💰 See the real cost

SubSentry converts subscription spending into understandable numbers:

* Monthly cost
* Yearly cost
* Upcoming renewals
* Spending breakdowns
* Potential savings

A subscription that looks cheap month-to-month can look very different when viewed over an entire year.

### 🧠 Get useful insights

The insights engine can identify situations such as:

* Unused subscriptions
* Duplicate subscriptions
* Upcoming renewals
* Potential savings opportunities
* Subscription health indicators

The goal is not simply to show data, but to help users understand what they should act on.

### ⚡ Manage subscriptions quickly

Users can:

* Add subscriptions manually
* Edit subscriptions
* Review imported subscriptions
* Bulk-update subscriptions
* Bulk-delete subscriptions
* View subscription details
* Identify potential duplicates

---

## 🛡️ Security & Privacy

SubSentry is built with security as a core requirement rather than an afterthought.

The project includes protections and infrastructure for:

* Authentication rate limiting
* Login lockouts
* Request-size limits
* CAPTCHA / bot protection
* Ownership-scoped data access
* Security event logging
* Password reset flows
* Email verification infrastructure
* Account deletion
* Protected API routes
* Environment-based secrets
* Input validation
* Database query auditing

Sensitive configuration such as `.env` and `.env.local` is intentionally excluded from Git.

**Never commit real API keys, database credentials, OAuth secrets, or other private credentials to the repository.**

---

## 🧪 Testing

SubSentry has both unit/integration testing and end-to-end browser testing.

Current project verification includes:

* **526** unit/integration tests passing
* Playwright end-to-end tests
* Authentication tests
* Security tests
* Import-flow tests
* Password-reset tests
* Account-deletion tests
* Subscription duplicate-detection tests
* Mobile layout tests
* SEO tests
* Static-page hydration tests

The project also runs:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Playwright can be run with:

```bash
npx playwright test
```

Some browser tests may depend on external services such as CAPTCHA and can require appropriate local test configuration.

---

## 🎨 Frontend

SubSentry uses a modern Next.js frontend with a focus on a clean, premium fintech-style experience.

The UI uses:

* Next.js
* React
* TypeScript
* Tailwind CSS
* shadcn/ui
* Framer Motion

The application includes:

* Responsive dashboard
* Subscription explorer
* Savings views
* Import center
* Settings
* Authentication flows
* Marketing pages
* Subscription cost calculator
* Subscription tracker
* Guides and SEO-focused public pages

---

## 🏗️ Architecture

The project follows a feature-oriented architecture with separation between UI, API routes, domain logic, repositories, and infrastructure.

Major areas include:

```text
src/
├── app/
│   ├── (app)/
│   ├── (auth)/
│   ├── api/
│   ├── guides/
│   ├── privacy/
│   ├── terms/
│   └── ...
│
├── components/
│   ├── dashboard/
│   ├── imports/
│   ├── landing/
│   ├── marketing/
│   ├── settings/
│   ├── subscriptions/
│   └── ui/
│
└── lib/
    ├── ai/
    ├── auth/
    ├── db/
    ├── http/
    ├── imports/
    ├── insights-engine/
    ├── observability/
    └── subscriptions/
```

---

## 🤖 AI

SubSentry has an AI layer for generating/narrating subscription insights.

The AI provider architecture is separated from the application logic so that the application can use different providers or a demo provider when required.

Environment configuration is used for API credentials rather than storing secrets in source code.

---

## 🗄️ Database

The project uses:

* Drizzle ORM
* SQLite/PGlite development infrastructure
* Migration files under `drizzle/`

Money values are represented in integer minor units where appropriate to avoid floating-point financial calculations.

Database access is designed around ownership-scoped queries and explicit data access rather than exposing arbitrary records to authenticated users.

---

## 🌐 SEO

SubSentry includes a dedicated SEO implementation for public pages.

Current SEO infrastructure includes:

* Unique page titles
* Meta descriptions
* Canonical URLs
* Open Graph metadata
* Twitter metadata
* JSON-LD structured data
* Sitemap generation
* Robots configuration
* Proper HTML language declaration
* Accessible image alt text
* Branded 404 pages
* Public marketing/content pages

The SEO implementation intentionally avoids fabricating a production domain when one has not been configured.

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/ewviie/SubSentry.git
cd SubSentry
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a local environment file:

```bash
cp .env.example .env.local
```

Then fill in the required values.

**Never commit `.env.local`.**

### 4. Start the development server

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

---

## 🔐 Environment Variables

SubSentry uses environment variables for configuration and secrets.

Depending on the enabled features, configuration may include:

* Database connection
* Application URL
* AI provider credentials
* SMTP configuration
* OAuth credentials
* Plaid configuration
* TrueLayer configuration
* Stripe configuration
* CAPTCHA configuration

See `.env.example` for the expected configuration.

Do not copy production secrets into `.env.example`.

---

## 📦 Production Build

To verify the production build locally:

```bash
npm run build
npm start
```

Then inspect the production application rather than relying only on the development server.

---

## 📁 Important Files

| File / Directory           | Purpose                         |
| -------------------------- | ------------------------------- |
| `src/app/`                 | Next.js routes and pages        |
| `src/app/api/`             | API endpoints                   |
| `src/components/`          | UI components                   |
| `src/lib/auth/`            | Authentication logic            |
| `src/lib/imports/`         | Financial import infrastructure |
| `src/lib/insights-engine/` | Subscription insights engine    |
| `src/lib/subscriptions/`   | Subscription domain logic       |
| `src/lib/ai/`              | AI provider infrastructure      |
| `src/lib/db/`              | Database/schema infrastructure  |
| `drizzle/`                 | Database migrations             |
| `e2e/`                     | Playwright end-to-end tests     |
| `.env.example`             | Environment variable template   |

---

## 🗺️ Project Status

SubSentry is an actively developed project.

The core application includes:

* Subscription tracking
* Recurring-payment detection
* Import/review workflows
* Savings insights
* Authentication
* Password reset
* Account deletion
* Security protections
* AI insight infrastructure
* Marketing/SEO pages
* Automated testing

Some financial integrations and production infrastructure require external provider configuration before they can be used in a live deployment.

---

## 🤝 Contributing

If you're working on SubSentry with the team:

1. Create a branch for your change.
2. Make your changes.
3. Run the relevant tests.
4. Run the production build when appropriate.
5. Review your diff.
6. Open a pull request.

For larger changes, prefer:

```text
feature branch
     ↓
pull request
     ↓
review
     ↓
main
```

Avoid committing secrets or local environment files.

---

## 📜 License

This project is currently maintained as a private/controlled project. Licensing terms may change as the project evolves.

---

## 💡 The Idea

Subscriptions are designed to be easy to start and easy to forget.

A few dollars here.
Another subscription there.
Then another annual renewal.

Eventually, you're paying for things you barely remember signing up for.

**SubSentry exists to make those payments visible — and give you the information you need to decide what stays and what goes.**

