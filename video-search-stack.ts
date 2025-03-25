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

    // 创建VPC
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

    // 创建单个S3存储桶，用于视频输入、输出和前端托管
    const unifiedBucket = new s3.Bucket(this, 'UnifiedBucket', {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      eventBridgeEnabled: true, // 启用 EventBridge 通知
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
    
    // 创建 CloudFront Origin Access Identity
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'CloudFrontOAI', {
      comment: 'OAI for video search frontend'
    });
    
    // 授予 OAI 访问 S3 存储桶的权限
    unifiedBucket.grantRead(originAccessIdentity);

    // 创建API Gateway
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
      },
    });

    // 创建API Gateway的CloudFront源
    const apiOrigin = new origins.HttpOrigin(`${api.restApiId}.execute-api.${this.region}.amazonaws.com`, {
      originPath: '/prod',
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    // 创建CloudFront分发
    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(unifiedBucket, {
          originPath: '/frontend', // 指定前端文件的路径前缀
          originAccessIdentity: originAccessIdentity
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      // 添加额外的行为，用于访问视频文件
      additionalBehaviors: {
        'video-input/*': {
          origin: new origins.S3Origin(unifiedBucket, {
            originAccessIdentity: originAccessIdentity
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
            originAccessIdentity: originAccessIdentity
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
        // 添加API行为，允许所有HTTP方法并禁用缓存
        'api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL, // 允许所有HTTP方法，包括POST
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // 禁用缓存
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER, // 转发所有请求头和查询字符串
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

    // 创建DocumentDB集群
    const docdbCluster = new docdb.DatabaseCluster(this, 'VideoDataCluster', {
      masterUser: {
        username: 'username123',
        password: cdk.SecretValue.unsafePlainText('Password123'),
      },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      instances: 1, // 减少实例数量以加快初始化
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      vpc: vpc,
      deletionProtection: false, // 修改为false以便于测试环境中删除
      engineVersion: '5.0.0',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // 修改为DESTROY以便于测试环境中删除
    });
    
    // 创建参数组并应用到集群
    const clusterParameterGroup = new docdb.CfnDBClusterParameterGroup(this, 'VideoDataClusterParams', {
      family: 'docdb5.0',
      description: 'Custom parameter group for Video Search application',
      parameters: {
        'tls': 'disabled'  // 禁用 TLS 要求
      }
    });
    
    // 获取底层的 CfnDBCluster 资源
    const cfnCluster = docdbCluster.node.defaultChild as docdb.CfnDBCluster;
    
    // 设置参数组和日志导出
    cfnCluster.dbClusterParameterGroupName = clusterParameterGroup.ref;
    cfnCluster.enableCloudwatchLogsExports = ['audit', 'profiler'];

    // 创建Lambda执行角色
    const lambdaRole = new iam.Role(this, 'VideoSearchLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess'),
      ],
    });

    // 添加Bedrock权限
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:*',
        'bedrock-runtime:*',
        'bedrock-data-automation:*',
        'bedrock-data-automation-runtime:*',
      ],
      resources: ['*'],
    }));
    
    // 添加更多权限
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

    // 创建安全组
    const lambdaSG = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: vpc,
      description: 'Security group for Lambda functions',
      allowAllOutbound: true,
    });

    // 允许Lambda访问DocumentDB
    docdbCluster.connections.allowFrom(lambdaSG, ec2.Port.tcp(27017));

    // 获取DocumentDB连接密钥
    const dbSecret = secretsmanager.Secret.fromSecretNameV2(
      this, 'DocDBSecret', '/video-search/docdb/masteruser'
    );

    // 构建MongoDB连接URI
    const mongoDbUri = `mongodb://username123:Password123@${docdbCluster.clusterEndpoint.hostname}:27017/?replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false&ssl=false`;

    // 创建Lambda Layer
    const pythonLayer = new lambda.LayerVersion(this, 'PythonDependenciesLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, 'assets/lambda-layer')),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],  // 改为 Python 3.11
      description: 'Python dependencies for Lambda functions',
    });

    // 创建Lambda函数 - 搜索视频
    const searchVideoFunction = new lambda.Function(this, 'SearchVideoFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'search_video.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'assets/lambda/search-video')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      vpc: vpc,
      role: lambdaRole, // 使用已定义的具有Bedrock权限的角色
      securityGroups: [lambdaSG],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      environment: {
        'DB_ENDPOINT': docdbCluster.clusterEndpoint.hostname,
        'DB_PORT': '27017',
        'DB_USERNAME': 'username123',
        'DB_PASSWORD': 'Password123',
        'DB_NAME': 'VideoData',
        'COLLECTION_NAME': 'videodata',
        'DEPLOY_REGION': this.region, // 使用 DEPLOY_REGION 而不是 AWS_REGION
        'LOG_LEVEL': 'DEBUG',  // 设置日志级别
      },
      layers: [pythonLayer], // 添加Layer
    });

    // 创建Lambda函数 - 提取视频数据
    const extractVideoDataFunction = new lambda.Function(this, 'ExtractVideoDataFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'assets/lambda/extract-video-data')),
      timeout: cdk.Duration.seconds(300),
      memorySize: 1024,
      vpc: vpc,
      role: lambdaRole, // 使用已定义的具有Bedrock权限的角色
      securityGroups: [lambdaSG],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      environment: {
        'DB_ENDPOINT': docdbCluster.clusterEndpoint.hostname,
        'DB_PORT': '27017',
        'DB_USERNAME': 'username123',
        'DB_PASSWORD': 'Password123',
        'DB_NAME': 'VideoData',
        'COLLECTION_NAME': 'videodata',
        'DEPLOY_REGION': this.region,
        'LOG_LEVEL': 'DEBUG',
        'BUCKET_NAME': unifiedBucket.bucketName, // 使用统一存储桶
      },
      layers: [pythonLayer], // 添加Layer
    });

    // 创建 BDA 项目的 Lambda 函数
    const createBDAProjectFunction = new lambda.Function(this, 'CreateBDAProjectFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'create_bda_project.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'assets/lambda/create-bda-project')),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      role: lambdaRole, // 使用已定义的具有Bedrock权限的角色
      environment: {
        'PROJECT_NAME': 'VideoDataProject',
        'DEPLOY_REGION': this.region,
      },
      layers: [pythonLayer], // 添加Layer
    });

    // 创建自定义资源来确保在部署时创建 BDA 项目
    const bdaProjectProvider = new cr.Provider(this, 'BDAProjectProvider', {
      onEventHandler: createBDAProjectFunction,
    });

    new cdk.CustomResource(this, 'BDAProject', {
      serviceToken: bdaProjectProvider.serviceToken,
      properties: {
        // 添加时间戳属性，确保每次部署都会触发
        Timestamp: new Date().toISOString(),
      },
    });

    // 创建Lambda函数 - 触发视频数据自动化
    const triggerVideoDataAutomationFunction = new lambda.Function(this, 'TriggerVideoDataAutomationFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'assets/lambda/trigger-video-data-automation')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      role: lambdaRole, // 使用已定义的具有Bedrock权限的角色
      environment: {
        'BDA_RUNTIME_ENDPOINT': `https://bedrock-data-automation-runtime.${this.region}.amazonaws.com`,
        'DATA_PROJECT_NAME': 'VideoDataProject',
        'TARGET_BUCKET_NAME': unifiedBucket.bucketName, // 使用统一存储桶
        'DEPLOY_REGION': this.region,
      },
      layers: [pythonLayer], // 添加Layer
    });

    // 授予S3读写权限
    unifiedBucket.grantRead(triggerVideoDataAutomationFunction);
    unifiedBucket.grantReadWrite(extractVideoDataFunction);

    // 允许DocumentDB密钥访问
    dbSecret.grantRead(searchVideoFunction);
    dbSecret.grantRead(extractVideoDataFunction);

    // 创建初始化数据库的Lambda函数
    const initDbFunction = new lambda.Function(this, 'InitDbFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'init_db.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'assets/lambda/init-db')),
      timeout: cdk.Duration.seconds(600), // 增加到 10 分钟
      memorySize: 256,
      vpc: vpc,
      role: lambdaRole, // 使用已定义的具有Bedrock权限的角色
      securityGroups: [lambdaSG],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      environment: {
        'DB_ENDPOINT': docdbCluster.clusterEndpoint.hostname,
        'DB_PORT': '27017',
        'DB_USERNAME': 'username123',
        'DB_PASSWORD': 'Password123',
        'DB_NAME': 'VideoData',
        'COLLECTION_NAME': 'videodata',
        'DEPLOY_REGION': this.region, // 使用 DEPLOY_REGION 而不是 AWS_REGION
        'LOG_LEVEL': 'DEBUG',  // 设置日志级别
      },
      layers: [pythonLayer], // 添加Layer
    });

    // 授予DocumentDB密钥访问权限
    dbSecret.grantRead(initDbFunction);

    // 创建自定义资源来确保在部署时运行初始化
    const dbInitializerProvider = new cr.Provider(this, 'DbInitializerProvider', {
      onEventHandler: initDbFunction,
      // 移除 totalTimeout 参数，因为我们没有提供 isCompleteHandler
    });
    
    // 确保 Provider 在 DocumentDB 集群可用后才运行
    dbInitializerProvider.node.addDependency(docdbCluster);
    
    new cdk.CustomResource(this, 'DbInitializer', {
      serviceToken: dbInitializerProvider.serviceToken,
      properties: {
        // 添加时间戳属性，确保每次部署都会触发
        Timestamp: new Date().toISOString(),
      },
    });

    // 创建API资源和方法
    const searchResource = api.root.addResource('search');
    
    // 添加POST方法，集成Lambda函数
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

    // 部署前端静态资源（不包括config.js）
    const frontendDeployment = new s3deploy.BucketDeployment(this, 'DeployFrontendStatic', {
      sources: [s3deploy.Source.asset(path.join(__dirname, 'assets/frontend'), {
        exclude: ['config.js', 'update-cdk.md'] // 排除 config.js 和不需要的文档文件
      })],
      destinationBucket: unifiedBucket,
      destinationKeyPrefix: 'frontend',
      prune: true, // 删除目标中不存在于源中的文件
      retainOnDelete: false, // 删除堆栈时删除文件
      distribution, // 添加 CloudFront 分发
      distributionPaths: ['/*'], // 使所有路径的缓存失效
      memoryLimit: 1024, // 增加到 1024MB
      useEfs: false,
      vpc: undefined,
      ephemeralStorageSize: cdk.Size.mebibytes(2048), // 增加到 2GB
    });

    // 确保前端静态资源部署在S3存储桶创建后执行
    frontendDeployment.node.addDependency(unifiedBucket);
    
    // 确保前端部署在API Gateway和CloudFront创建后执行
    frontendDeployment.node.addDependency(api);
    frontendDeployment.node.addDependency(distribution);

    // 创建一个包含API Gateway URL和CloudFront URL的config.js文件
    const configFileContent = `window.CONFIG = {
  API_ENDPOINT: 'https://${api.restApiId}.execute-api.${this.region}.amazonaws.com/prod',
  CLOUDFRONT_URL: 'https://${distribution.distributionDomainName}',
  VIDEO_BASE_URL: 'https://${distribution.distributionDomainName}/video-input'
};`;

    // 部署配置文件（在API Gateway和CloudFront创建后）
    const configDeployment = new s3deploy.BucketDeployment(this, 'DeployFrontendConfig', {
      sources: [s3deploy.Source.data('config.js', configFileContent)],
      destinationBucket: unifiedBucket,
      destinationKeyPrefix: 'frontend',
      distribution,
      distributionPaths: ['/config.js'], // 只使config.js缓存失效
      memoryLimit: 512, // 增加内存限制
      useEfs: false,
      vpc: undefined,
      ephemeralStorageSize: cdk.Size.mebibytes(1024), // 增加临时存储空间
      prune: false, // 关键修改：不删除其他文件
    });
    
    // 确保配置文件部署在API Gateway和CloudFront创建后执行
    configDeployment.node.addDependency(api);
    configDeployment.node.addDependency(distribution);

    // 创建video-input和video-output文件夹
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
    
    // 输出CloudFront URL
    new cdk.CfnOutput(this, 'FrontendURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'URL for the frontend application',
    });

    // 创建EventBridge规则 - 监听S3视频上传
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

    // 添加Lambda目标
    videoUploadRule.addTarget(new targets.LambdaFunction(triggerVideoDataAutomationFunction));

    // 创建EventBridge规则 - 监听S3视频输出结果文件
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

    // 添加Lambda目标
    s3VideoDataExtractRule.addTarget(new targets.LambdaFunction(extractVideoDataFunction));

    // 输出重要资源信息
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
