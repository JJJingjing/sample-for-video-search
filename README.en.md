# Language Selection / 语言选择
- [English](#sample-for-video-search)
- [中文](README.md)

# Sample for Video Search

This is a video search application built with AWS CDK, using Amazon Bedrock and DocumentDB to implement intelligent search functionality for video content. The application allows users to search video content through text descriptions or scene descriptions, and precisely locate relevant timestamps.

## License

This project uses the [MIT-0 License](LICENSE).

## Third-Party Components

This project uses multiple third-party open-source components. For detailed information, please refer to the [THIRD-PARTY.md](THIRD-PARTY.md) file.

## Architecture Overview

The application includes the following main components:

- **Frontend**: A simple web application based on HTML/CSS/JavaScript
- **API Gateway**: Handles frontend requests
- **Lambda Functions**: Process search logic and video data extraction
- **DocumentDB**: Stores video metadata and search indices
- **Amazon Bedrock**: Provides AI capabilities for video content understanding and search
- **S3**: Stores video files and processing results
- **CloudFront**: Provides content distribution

## Features

- **Multi-mode Search**: Supports both text search and scene search modes
- **Precise Positioning**: Automatically positions videos to relevant timestamps
- **Similarity Ranking**: Search results are displayed sorted by relevance
- **Automatic Processing**: Newly uploaded videos are automatically processed and indexed
- **Scalable Architecture**: Based on serverless architecture, automatically scales according to demand

## Prerequisites

- [AWS Account](https://aws.amazon.com/)
- [AWS CLI](https://aws.amazon.com/cli/) installed and configured
- [Node.js](https://nodejs.org/) (≥ 14.x) and [npm](https://www.npmjs.com/)
- [AWS CDK](https://aws.amazon.com/cdk/) installed (`npm install -g aws-cdk`)
- [Python](https://www.python.org/) 3.11 or higher

## Deployment Guide

### 1. Set up Python Virtual Environment

It's recommended to use a virtual environment to isolate project dependencies:

```bash
# Create virtual environment
python -m venv .venv

# Activate virtual environment
## Windows
.venv\Scripts\activate
## macOS/Linux
source .venv/bin/activate

# Verify virtual environment
which python  # Should display Python path in the virtual environment
```

After activating the virtual environment, the terminal prompt will be prefixed with `(.venv)`, indicating that you're currently in the virtual environment. All subsequent Python package installations will be performed in this isolated environment.

### 2. Clone the Repository

```bash
git clone <repository-url>
cd sample-for-video-search
```

### 3. Install Dependencies

```bash
# Install CDK dependencies
npm install

# Install Lambda layer dependencies
cd assets/lambda-layer
pip install -r requirements.txt -t python
cd ../..
```

### 4. Configure AWS Environment

Ensure your AWS CLI is correctly configured and has sufficient permissions:

```bash
aws configure
```

### 5. Bootstrap CDK Environment (First time using CDK)

You need to provide a password parameter for DocumentDB:

```bash
cdk bootstrap --context dbPassword=your_secure_password
```

### 6. Deploy the Stack

When deploying, you need to provide a username and password for DocumentDB:

```bash
# Use default username 'dbadmin' and custom password
cdk deploy --context dbPassword=your_secure_password

# Or customize both username and password (Note: 'admin' is a reserved word and cannot be used as username)
cdk deploy --context dbUsername=your_username --context dbPassword=your_secure_password
```

After deployment is complete, CDK will output the following information:

- **FrontendURL**: URL for the frontend application
- **ApiEndpoint**: URL for the API Gateway
- **UnifiedBucketName**: S3 bucket name
- **DocumentDBEndpoint**: DocumentDB cluster endpoint

### 7. Upload Videos

You can use the AWS Console or AWS CLI to upload videos to the `video-input` folder in the S3 bucket:

```bash
aws s3 cp your-video.mp4 s3://<UnifiedBucketName>/video-input/
```

After uploading, the system will automatically process the video and create search indices.

## Usage Guide

1. Visit the **FrontendURL** provided after deployment
2. Enter keywords or scene descriptions in the search box
3. Select the search mode (text search or scene search)
4. Click the search button
5. View results, which will be sorted by relevance
6. Click on a video to start playing from the relevant timestamp

## Customization and Configuration

### Modifying the Frontend

Frontend files are located in the `assets/frontend` directory:

- `index.html`: Main page structure
- `app.js`: Application logic
- `config.js`: Configuration file (automatically generated by CDK)

### Modifying Lambda Functions

Lambda functions are located in the `assets/lambda` directory:

- `search-video`: Processes search requests
- `extract-video-data`: Processes video data extraction
- `create-bda-project`: Creates Bedrock Data Automation projects
- `trigger-video-data-automation`: Triggers video data automation processing
- `init-db`: Initializes the database

### Modifying the CDK Stack

The main CDK stack definition is in the `video-search-stack.ts` file.

## Cleaning Up Resources

To delete all created resources, run:

```bash
cdk destroy
```

After completion, you can exit the virtual environment:

```bash
deactivate
```

If you need to completely remove the virtual environment, you can simply delete the `.venv` directory.

## Troubleshooting

- **Frontend cannot connect to API**: Check if the API endpoint in the `config.js` file is correct
- **Videos cannot play**: Confirm that videos have been uploaded to the correct S3 path and that the CloudFront distribution is configured correctly
- **No search results**: Check if the DocumentDB connection and indices are created correctly
- **Lambda function timeout**: Consider increasing the Lambda function timeout settings and memory allocation
- **Virtual environment issues**: If you encounter Python package conflicts or version issues, try deleting and recreating the virtual environment

## Security Considerations

- This application uses DocumentDB username and password for authentication; in a production environment, these credentials should be managed using AWS Secrets Manager
- API Gateway is configured to allow all origins; in a production environment, this should be restricted to specific domain names
- S3 buckets are configured to block public access, with content served through CloudFront
- Dependency packages in the virtual environment should be regularly updated to fix potential security vulnerabilities
