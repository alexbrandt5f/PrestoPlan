# Contributing to PrestoPlan

Thank you for your interest in contributing to PrestoPlan! This document provides guidelines and instructions for contributing.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/PrestoPlan.git`
3. Create a new branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Test your changes thoroughly
6. Commit with clear messages
7. Push to your fork
8. Create a Pull Request

## Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables (see README.md)

3. Start the development server:
   ```bash
   npm run dev
   ```

## Code Style

- Follow the existing code style
- Use TypeScript for all new code
- Run `npm run lint` before committing
- Run `npm run typecheck` to check for type errors
- Use meaningful variable and function names
- Add comments for complex logic

## Commit Messages

Follow conventional commit format:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

Example: `feat: add task filtering to gantt chart`

## Pull Request Process

1. Update the README.md with details of changes if needed
2. Ensure all tests pass and the build succeeds
3. Update documentation for any new features
4. Request review from maintainers
5. Address any feedback from reviewers
6. Once approved, your PR will be merged

## Testing

- Test your changes in multiple browsers
- Test responsive design on different screen sizes
- Verify database operations don't break existing functionality
- Check that authentication flows work correctly

## Database Changes

If your changes involve database modifications:

1. Create a new migration file in `supabase/migrations/`
2. Follow the existing migration naming convention
3. Include comprehensive comments explaining the changes
4. Test the migration in a development environment first
5. Ensure RLS policies are correctly configured

## Reporting Bugs

When reporting bugs, include:

- Clear description of the issue
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots if applicable
- Browser and OS information
- Console errors if any

## Feature Requests

For feature requests:

- Clearly describe the proposed feature
- Explain the use case and benefits
- Provide mockups or examples if applicable
- Discuss potential implementation approaches

## Questions?

If you have questions, feel free to:

- Open an issue with the `question` label
- Reach out to the maintainers

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Maintain a positive environment

Thank you for contributing to PrestoPlan!
