# Video Search Frontend

This is a simple video search frontend application used to connect to API Gateway and CloudFront resources.

## Features

- Supports two search modes: text search and scene search
- Displays video search results, including video clips and related text
- Automatically positions videos to relevant timestamps
- Displays timestamp information

## File Structure

- `index.html` - Main page
- `app.js` - Application logic
- `config.js` - Configuration file (will be replaced during the CDK deployment process)

## Deployment Instructions

This frontend is integrated into the CDK stack and will be automatically deployed when deploying the CDK stack.

## Usage

1. Enter keywords in the search box
2. Select the search mode (text search or scene search)
3. Click the search button
4. View the returned video results
