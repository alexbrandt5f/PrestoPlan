# PrestoPlan

A modern project management and scheduling application built with React, TypeScript, and Supabase. PrestoPlan provides advanced Gantt chart visualization and project tracking capabilities for construction and project management professionals.

## Features

- **Advanced Gantt Chart Viewer**: Interactive timeline visualization with customizable views
- **XER File Support**: Import and parse Primavera P6 XER schedule files
- **Project Management**: Create, organize, and track multiple projects
- **Schedule Versioning**: Maintain and compare different versions of project schedules
- **User Authentication**: Secure email/password authentication with Supabase
- **Responsive Design**: Beautiful, production-ready UI that works on all devices
- **Real-time Updates**: Live data synchronization across users

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Tailwind CSS
- **Backend**: Supabase (PostgreSQL, Auth, Storage, Edge Functions)
- **Routing**: React Router v7
- **Icons**: Lucide React
- **File Processing**: Web Workers for XER parsing

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- A Supabase account and project

### Installation

1. Clone the repository:
```bash
git clone https://github.com/alexbrandt5f/PrestoPlan.git
cd PrestoPlan
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:

Create a `.env` file in the root directory with the following variables:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

To get these values:
- Go to your [Supabase Dashboard](https://app.supabase.com)
- Select your project
- Navigate to Settings > API
- Copy the Project URL and anon/public key

4. Run database migrations:

The Supabase migrations are located in `supabase/migrations/`. To apply them:
- Use the Supabase CLI: `supabase db push`
- Or apply them manually through the Supabase SQL Editor

5. Deploy Edge Functions (optional):

If you need the XER parsing edge function:
```bash
supabase functions deploy parse-xer
```

### Development

Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

### Building for Production

Build the project:
```bash
npm run build
```

Preview the production build:
```bash
npm run preview
```

## Project Structure

```
PrestoPlan/
├── src/
│   ├── components/        # React components
│   │   ├── gantt/        # Gantt chart components
│   │   └── ...
│   ├── contexts/         # React context providers
│   ├── hooks/            # Custom React hooks
│   ├── lib/              # Utility functions and configurations
│   ├── pages/            # Page components
│   ├── types/            # TypeScript type definitions
│   └── workers/          # Web Workers for heavy processing
├── supabase/
│   ├── functions/        # Supabase Edge Functions
│   └── migrations/       # Database migrations
└── ...
```

## Database Schema

The application uses the following main tables:
- `companies`: Organization/company information
- `projects`: Project metadata and settings
- `schedule_versions`: Different versions of project schedules
- `tasks`: Individual schedule activities/tasks
- `relationships`: Task dependencies and relationships

All tables have Row Level Security (RLS) enabled for data protection.

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm run typecheck` - Run TypeScript type checking

## Security

- All sensitive credentials are stored in environment variables
- Never commit `.env` files to the repository
- Row Level Security (RLS) is enabled on all database tables
- Authentication is handled securely through Supabase Auth

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## Deployment

This project can be deployed to various platforms:

- **Vercel**: Connect your GitHub repository for automatic deployments
- **Netlify**: Use the build command `npm run build` and publish directory `dist`
- **Other platforms**: Any static hosting service that supports Vite builds

Remember to configure environment variables in your hosting platform's settings.

## License

This project is private and proprietary.

## Support

For issues, questions, or contributions, please open an issue on GitHub.
