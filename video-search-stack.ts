// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as docdb from 'aws-cdk-lib/aws-docdb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as path from 'path';

export class VideoSearchStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC
    const vpc = new ec2.Vpc(this, 'VideoSearchVPC', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24
        }
      ]
    });

    // Create a single S3 bucket for video input, output, and frontend hosting
    const unifiedBucket = new s3.Bucket(this, 'UnifiedBucket', {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      eventBridgeEnabled: true, // Enable EventBridge notifications
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag', 'Content-Length', 'Content-Type', 'Content-Range', 'Accept-Ranges'],
          maxAge: 3600,
        },
      ],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });
    
    // Create CloudWatch log group for API Gateway access logs
    const apiLogGroup = new cdk.aws_logs.LogGroup(this, 'ApiGatewayAccessLogs', {
      retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Create API Gateway
    const api = new apigateway.RestApi(this, 'VideoSearchApi', {
      restApiName: 'Video Search API',
      description: 'API for searching video content',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Requested-With', 'Accept', 'Access-Control-Allow-Origin', 'Access-Control-Allow-Methods', 'Access-Control-Allow-Headers'],
        allowCredentials: true,
        maxAge: cdk.Duration.days(1),
      },
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        // Add access log configuration
        accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          caller: true,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true
        })
      },
    });

    // Create CloudFront origin for API Gateway
    const apiOrigin = new origins.HttpOrigin(`${api.restApiId}.execute-api.${this.region}.amazonaws.com`, {
      originPath: '/prod',
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    // Create CloudWatch log group for CloudFront access logs
    const cloudFrontLogBucket = new s3.Bucket(this, 'CloudFrontLogsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED, // Enable ACL access
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(90), // Retain logs for 90 days
        }
      ]
    });

    // Create Origin Access Control
    const oac = new cloudfront.CfnOriginAccessControl(this, 'CloudFrontOAC', {
      originAccessControlConfig: {
        name: 'CloudFrontOAC',
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4'
      }
    });

    // Create CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(unifiedBucket, {
          originPath: '/frontend', // Specify frontend files path prefix
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      // Enable access logs
      enableLogging: true,
      logBucket: cloudFrontLogBucket,
      logFilePrefix: 'cloudfront-logs/',
      // Add additional behaviors for accessing video files
      additionalBehaviors: {
        'video-input/*': {
          origin: new origins.S3Origin(unifiedBucket, {
            // Remove originAccessIdentity
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(this, 'VideoInputCorsPolicy', {
            corsBehavior: {
              accessControlAllowOrigins: ['*'],
              accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS'],
              accessControlAllowHeaders: ['*'],
              accessControlMaxAge: cdk.Duration.seconds(3600),
              originOverride: true,
              accessControlAllowCredentials: false
            }
          }),
        },
        'video-output/*': {
          origin: new origins.S3Origin(unifiedBucket, {
            // Remove originAccessIdentity
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(this, 'VideoOutputCorsPolicy', {
            corsBehavior: {
              accessControlAllowOrigins: ['*'],
              accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS'],
              accessControlAllowHeaders: ['*'],
              accessControlMaxAge: cdk.Duration.seconds(3600),
              originOverride: true,
              accessControlAllowCredentials: false
            }
          }),
        },
        // Add API behavior, allow all HTTP methods and disable caching
        'api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL, // Allow all HTTP methods, including POST
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // Disable caching
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER, // Forward all request headers and query strings
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // Get underlying CloudFront resource
    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution;

    // Modify S3 origin configuration to use OAC
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity', '');
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.OriginAccessControlId', oac.getAtt('Id'));
    
    // Modify additional behaviors' S3 origin configuration to use OAC
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.1.S3OriginConfig.OriginAccessIdentity', '');
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.1.OriginAccessControlId', oac.getAtt('Id'));
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.2.S3OriginConfig.OriginAccessIdentity', '');
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.2.OriginAccessControlId', oac.getAtt('Id'));

    // Create policy to allow CloudFront to access S3
    const bucketPolicy = new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      resources: [
        `${unifiedBucket.bucketArn}/frontend/*`,
        `${unifiedBucket.bucketArn}/video-input/*`,
        `${unifiedBucket.bucketArn}/video-output/*`
      ],
      conditions: {
        StringEquals: {
          'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`
        }
      }
    });

    // Add policy to the bucket
    unifiedBucket.addToResourcePolicy(bucketPolicy);

    // Get username and password from context or use defaults
    // Note: 'admin' is a reserved word in DocumentDB and cannot be used as username
    const dbUsername = this.node.tryGetContext('dbUsername') || 'dbadmin';
    const dbPassword = this.node.tryGetContext('dbPassword');
    
    // Validate that password is provided
    if (!dbPassword) {
      throw new Error('Database password must be provided. Use --context dbPassword=YOUR_PASSWORD parameter');
    }

    // Create DocumentDB cluster
    const docdbCluster = new docdb.DatabaseCluster(this, 'VideoDataCluster', {
      masterUser: {
        username: dbUsername,
        password: cdk.SecretValue.unsafePlainText(dbPassword),
      },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      instances: 1, // Reduce instance count to speed up initialization
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      vpc: vpc,
      deletionProtection: false, // Set to false for easier deletion in test environments
      engineVersion: '5.0.0',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Set to DESTROY for easier deletion in test environments
    });
    
    // Create parameter group and apply to cluster
    const clusterParameterGroup = new docdb.CfnDBClusterParameterGroup(this, 'VideoDataClusterParams', {
      family: 'docdb5.0',
      description: 'Custom parameter group for Video Search application',
      parameters: {
        'tls': 'disabled'  // Disable TLS requirement
      }
    });
    
    // Get underlying CfnDBCluster resource
    const cfnCluster = docdbCluster.node.defaultChild as docdb.CfnDBCluster;
    
    // Set parameter group and log exports
    cfnCluster.dbClusterParameterGroupName = clusterParameterGroup.ref;
    cfnCluster.enableCloudwatchLogsExports = ['audit', 'profiler'];

    // Create Lambda execution role
    const lambdaRole = new iam.Role(this, 'VideoSearchLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess'),
      ],
    });

    // Add Bedrock permissions
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:*',
        'bedrock-runtime:*',
        'bedrock-data-automation:*',
        'bedrock-data-automation-runtime:*',
      ],
      resources: ['*'],
    }));
    
    // Add additional permissions
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'secretsmanager:GetSecretValue',
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'ec2:CreateNetworkInterface',
        'ec2:DescribeNetworkInterfaces',
        'ec2:DeleteNetworkInterface'
      ],
      resources: ['*'],
    }));

    // Create security group
    const lambdaSG = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: vpc,
      description: 'Security group for Lambda functions',
      allowAllOutbound: true,
    });

    // Allow Lambda to access DocumentDB
    docdbCluster.connections.allowFrom(lambdaSG, ec2.Port.tcp(27017));

    // Get DocumentDB connection secret
    const dbSecret = secretsmanager.Secret.fromSecretNameV2(
      this, 'DocDBSecret', '/video-search/docdb/masteruser'
    );

    // Build MongoDB connection URI
    const mongoDbUri = `mongodb://${dbUsername}:${dbPassword}@${docdbCluster.clusterEndpoint.hostname}:27017/?replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false&ssl=false`;

    // Create Lambda Layer
    const pythonLayer = new lambda.LayerVersion(this, 'PythonDependenciesLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, 'assets/lambda-layer')),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],  // Change to Python 3.11
      description: 'Python dependencies for Lambda functions',
    });

    // Create Lambda function - Search video
    const searchVideoFunction = new lambda.Function(this, 'SearchVideoFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'search_video.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'assets/lambda/search-video')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      vpc: vpc,
      role: lambdaRole, // Use the defined role with Bedrock permissions
      securityGroups: [lambdaSG],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      environment: {
        'DB_ENDPOINT': docdbCluster.clusterEndpoint.hostname,
        'DB_PORT': '27017',
        'DB_USERNAME': dbUsername,
        'DB_PASSWORD': dbPassword,
        'DB_NAME': 'VideoData',
        'COLLECTION_NAME': 'videodata',
        'DEPLOY_REGION': this.region, // Use DEPLOY_REGION instead of AWS_REGION
        'LOG_LEVEL': 'DEBUG',  // Set log level
      },
      layers: [pythonLayer], // Add Layer
    });

    // Create Lambda function - Extract video data
    const extractVideoDataFunction = new lambda.Function(this, 'ExtractVideoDataFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'assets/lambda/extract-video-data')),
      timeout: cdk.Duration.seconds(300),
      memorySize: 1024,
      vpc: vpc,
      role: lambdaRole, // Use the defined role with Bedrock permissions
      securityGroups: [lambdaSG],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      environment: {
        'DB_ENDPOINT': docdbCluster.clusterEndpoint.hostname,
        'DB_PORT': '27017',
        'DB_USERNAME': dbUsername,
        'DB_PASSWORD': dbPassword,
        'DB_NAME': 'VideoData',
        'COLLECTION_NAME': 'videodata',
        'DEPLOY_REGION': this.region,
        'LOG_LEVEL': 'DEBUG',
        'BUCKET_NAME': unifiedBucket.bucketName, // Use unified bucket
      },
      layers: [pythonLayer], // Add Layer
    });

    // Create Lambda function for BDA project
    const createBDAProjectFunction = new lambda.Function(this, 'CreateBDAProjectFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'create_bda_project.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'assets/lambda/create-bda-project')),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      role: lambdaRole, // Use the defined role with Bedrock permissions
      environment: {
        'PROJECT_NAME': 'VideoDataProject',
        'DEPLOY_REGION': this.region,
      },
      layers: [pythonLayer], // Add Layer
    });

    // Create custom resource to ensure BDA project is created during deployment
    const bdaProjectProvider = new cr.Provider(this, 'BDAProjectProvider', {
      onEventHandler: createBDAProjectFunction,
    });

    new cdk.CustomResource(this, 'BDAProject', {
      serviceToken: bdaProjectProvider.serviceToken,
      properties: {
        // Add timestamp property to ensure trigger on each deployment
        Timestamp: new Date().toISOString(),
      },
    });

    // Create Lambda function - Trigger video data automation
    const triggerVideoDataAutomationFunction = new lambda.Function(this, 'TriggerVideoDataAutomationFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'assets/lambda/trigger-video-data-automation')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      role: lambdaRole, // Use the defined role with Bedrock permissions
      environment: {
        'BDA_RUNTIME_ENDPOINT': `https://bedrock-data-automation-runtime.${this.region}.amazonaws.com`,
        'DATA_PROJECT_NAME': 'VideoDataProject',
        'TARGET_BUCKET_NAME': unifiedBucket.bucketName, // Use unified bucket
        'DEPLOY_REGION': this.region,
      },
      layers: [pythonLayer], // Add Layer
    });

    // Grant S3 read/write permissions
    unifiedBucket.grantRead(triggerVideoDataAutomationFunction);
    unifiedBucket.grantReadWrite(extractVideoDataFunction);

    // Allow DocumentDB secret access
    dbSecret.grantRead(searchVideoFunction);
    dbSecret.grantRead(extractVideoDataFunction);

    // Create Lambda function to initialize database
    const initDbFunction = new lambda.Function(this, 'InitDbFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'init_db.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'assets/lambda/init-db')),
      timeout: cdk.Duration.seconds(600), // Increase to 10 minutes
      memorySize: 256,
      vpc: vpc,
      role: lambdaRole, // Use the defined role with Bedrock permissions
      securityGroups: [lambdaSG],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      environment: {
        'DB_ENDPOINT': docdbCluster.clusterEndpoint.hostname,
        'DB_PORT': '27017',
        'DB_USERNAME': dbUsername,
        'DB_PASSWORD': dbPassword,
        'DB_NAME': 'VideoData',
        'COLLECTION_NAME': 'videodata',
        'DEPLOY_REGION': this.region, // Use DEPLOY_REGION instead of AWS_REGION
        'LOG_LEVEL': 'DEBUG',  // Set log level
      },
      layers: [pythonLayer], // Add Layer
    });

    // Grant DocumentDB secret access permissions
    dbSecret.grantRead(initDbFunction);

    // Create custom resource to ensure initialization runs during deployment
    const dbInitializerProvider = new cr.Provider(this, 'DbInitializerProvider', {
      onEventHandler: initDbFunction,
      // Remove totalTimeout parameter because we don't provide isCompleteHandler
    });
    
    // Ensure Provider runs only after DocumentDB cluster is available
    dbInitializerProvider.node.addDependency(docdbCluster);
    
    new cdk.CustomResource(this, 'DbInitializer', {
      serviceToken: dbInitializerProvider.serviceToken,
      properties: {
        // Add timestamp property to ensure trigger on each deployment
        Timestamp: new Date().toISOString(),
      },
    });

    // Create API resources and methods
    const searchResource = api.root.addResource('search');
    
    // Add POST method, integrate Lambda function
    searchResource.addMethod('POST', new apigateway.LambdaIntegration(searchVideoFunction, {
      proxy: true,
      integrationResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': "'*'",
            'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Requested-With,Accept'",
            'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,POST,GET'",
          },
        }
      ],
    }), {
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
          },
        }
      ]
    });

    // Deploy frontend static resources (excluding config.js)
    const frontendDeployment = new s3deploy.BucketDeployment(this, 'DeployFrontendStatic', {
      sources: [s3deploy.Source.asset(path.join(__dirname, 'assets/frontend'), {
        exclude: ['config.js', 'update-cdk.md'] // Exclude config.js and unnecessary documentation files
      })],
      destinationBucket: unifiedBucket,
      destinationKeyPrefix: 'frontend',
      prune: true, // Delete files in the destination that don't exist in the source
      retainOnDelete: false, // Delete files when stack is deleted
      distribution, // Add CloudFront distribution
      distributionPaths: ['/*'], // Invalidate all paths in cache
      memoryLimit: 1024, // Increase to 1024MB
      useEfs: false,
      vpc: undefined,
      ephemeralStorageSize: cdk.Size.mebibytes(2048), // Increase to 2GB
    });

    // Ensure frontend static resources deployment executes after S3 bucket creation
    frontendDeployment.node.addDependency(unifiedBucket);
    
    // Ensure frontend deployment executes after API Gateway and CloudFront creation
    frontendDeployment.node.addDependency(api);
    frontendDeployment.node.addDependency(distribution);

    // Create a config.js file containing API Gateway URL and CloudFront URL
    const configFileContent = `window.CONFIG = {
  API_ENDPOINT: 'https://${api.restApiId}.execute-api.${this.region}.amazonaws.com/prod',
  CLOUDFRONT_URL: 'https://${distribution.distributionDomainName}',
  VIDEO_BASE_URL: 'https://${distribution.distributionDomainName}/video-input'
};`;

    // Deploy configuration file (after API Gateway and CloudFront creation)
    const configDeployment = new s3deploy.BucketDeployment(this, 'DeployFrontendConfig', {
      sources: [s3deploy.Source.data('config.js', configFileContent)],
      destinationBucket: unifiedBucket,
      destinationKeyPrefix: 'frontend',
      distribution,
      distributionPaths: ['/config.js'], // Only invalidate config.js cache
      memoryLimit: 512, // Increase memory limit
      useEfs: false,
      vpc: undefined,
      ephemeralStorageSize: cdk.Size.mebibytes(1024), // Increase ephemeral storage
      prune: false, // Key modification: do not delete other files
    });
    
    // Ensure configuration file deployment executes after API Gateway and CloudFront creation
    configDeployment.node.addDependency(api);
    configDeployment.node.addDependency(distribution);

    // Create video-input and video-output folders
    const videoInputFolder = new s3deploy.BucketDeployment(this, 'CreateVideoFolders', {
      sources: [s3deploy.Source.data('video-input-test', '')],
      destinationBucket: unifiedBucket,
      destinationKeyPrefix: 'video-input/',
      memoryLimit: 512,
      useEfs: false,
      vpc: undefined,
      ephemeralStorageSize: cdk.Size.mebibytes(1024),
    });
    
    const videoOutputFolder = new s3deploy.BucketDeployment(this, 'CreateVideoOutputFolder', {
      sources: [s3deploy.Source.data('video-output-test', '')],
      destinationBucket: unifiedBucket,
      destinationKeyPrefix: 'video-output/',
      memoryLimit: 512,
      useEfs: false,
      vpc: undefined,
      ephemeralStorageSize: cdk.Size.mebibytes(1024),
    });
    
    // Output CloudFront URL
    new cdk.CfnOutput(this, 'FrontendURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'URL for the frontend application',
    });

    // Create EventBridge rule - Monitor S3 video uploads
    const videoUploadRule = new events.Rule(this, 'VideoUploadRule', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [unifiedBucket.bucketName],
          },
          object: {
            key: [{
              prefix: 'video-input/',
            }],
          },
        },
      },
    });

    // Add Lambda target
    videoUploadRule.addTarget(new targets.LambdaFunction(triggerVideoDataAutomationFunction));

    // Create EventBridge rule - Monitor S3 video output result files
    const s3VideoDataExtractRule = new events.Rule(this, 'S3VideoDataExtractRule', {
      ruleName: 's3-video-data-extract',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [unifiedBucket.bucketName],
          },
          object: {
            key: [{
              wildcard: 'video-output/*/result.json',
            }],
          },
        },
      },
    });

    // Add Lambda target
    s3VideoDataExtractRule.addTarget(new targets.LambdaFunction(extractVideoDataFunction));

    // Output important resource information
    new cdk.CfnOutput(this, 'UnifiedBucketName', {
      value: unifiedBucket.bucketName,
      description: 'S3 bucket for video input, output, and frontend hosting',
    });
    
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront URL for the frontend application',
    });
    
    new cdk.CfnOutput(this, 'DocumentDBEndpoint', {
      value: docdbCluster.clusterEndpoint.hostname,
      description: 'DocumentDB cluster endpoint',
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
    });
  }
}
