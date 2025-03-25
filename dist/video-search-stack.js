"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VideoSearchStack = void 0;
const cdk = require("aws-cdk-lib");
const s3 = require("aws-cdk-lib/aws-s3");
const docdb = require("aws-cdk-lib/aws-docdb");
const ec2 = require("aws-cdk-lib/aws-ec2");
const lambda = require("aws-cdk-lib/aws-lambda");
const iam = require("aws-cdk-lib/aws-iam");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const s3deploy = require("aws-cdk-lib/aws-s3-deployment");
const cloudfront = require("aws-cdk-lib/aws-cloudfront");
const origins = require("aws-cdk-lib/aws-cloudfront-origins");
const events = require("aws-cdk-lib/aws-events");
const targets = require("aws-cdk-lib/aws-events-targets");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
const cr = require("aws-cdk-lib/custom-resources");
const path = require("path");
class VideoSearchStack extends cdk.Stack {
    constructor(scope, id, props) {
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
            eventBridgeEnabled: true,
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
                    originPath: '/frontend',
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
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
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
            instances: 1,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            vpc: vpc,
            deletionProtection: false,
            engineVersion: '5.0.0',
            removalPolicy: cdk.RemovalPolicy.DESTROY, // 修改为DESTROY以便于测试环境中删除
        });
        // 创建参数组并应用到集群
        const clusterParameterGroup = new docdb.CfnDBClusterParameterGroup(this, 'VideoDataClusterParams', {
            family: 'docdb5.0',
            description: 'Custom parameter group for Video Search application',
            parameters: {
                'tls': 'disabled' // 禁用 TLS 要求
            }
        });
        // 获取底层的 CfnDBCluster 资源
        const cfnCluster = docdbCluster.node.defaultChild;
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
        const dbSecret = secretsmanager.Secret.fromSecretNameV2(this, 'DocDBSecret', '/video-search/docdb/masteruser');
        // 构建MongoDB连接URI
        const mongoDbUri = `mongodb://username123:Password123@${docdbCluster.clusterEndpoint.hostname}:27017/?replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false&ssl=false`;
        // 创建Lambda Layer
        const pythonLayer = new lambda.LayerVersion(this, 'PythonDependenciesLayer', {
            code: lambda.Code.fromAsset(path.join(__dirname, 'assets/lambda-layer')),
            compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],
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
            role: lambdaRole,
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
                'LOG_LEVEL': 'DEBUG', // 设置日志级别
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
            role: lambdaRole,
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
            role: lambdaRole,
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
            role: lambdaRole,
            environment: {
                'BDA_RUNTIME_ENDPOINT': `https://bedrock-data-automation-runtime.${this.region}.amazonaws.com`,
                'DATA_PROJECT_NAME': 'VideoDataProject',
                'TARGET_BUCKET_NAME': unifiedBucket.bucketName,
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
            timeout: cdk.Duration.seconds(600),
            memorySize: 256,
            vpc: vpc,
            role: lambdaRole,
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
                'LOG_LEVEL': 'DEBUG', // 设置日志级别
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
            prune: true,
            retainOnDelete: false,
            distribution,
            distributionPaths: ['/*'],
            memoryLimit: 1024,
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
            distributionPaths: ['/config.js'],
            memoryLimit: 512,
            useEfs: false,
            vpc: undefined,
            ephemeralStorageSize: cdk.Size.mebibytes(1024),
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
exports.VideoSearchStack = VideoSearchStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmlkZW8tc2VhcmNoLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vdmlkZW8tc2VhcmNoLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUVuQyx5Q0FBeUM7QUFDekMsK0NBQStDO0FBQy9DLDJDQUEyQztBQUMzQyxpREFBaUQ7QUFDakQsMkNBQTJDO0FBQzNDLHlEQUF5RDtBQUN6RCwwREFBMEQ7QUFDMUQseURBQXlEO0FBQ3pELDhEQUE4RDtBQUM5RCxpREFBaUQ7QUFDakQsMERBQTBEO0FBQzFELGlFQUFpRTtBQUNqRSxtREFBbUQ7QUFDbkQsNkJBQTZCO0FBRTdCLE1BQWEsZ0JBQWlCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDN0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixRQUFRO1FBQ1IsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUM5QyxNQUFNLEVBQUUsQ0FBQztZQUNULFdBQVcsRUFBRSxDQUFDO1lBQ2QsbUJBQW1CLEVBQUU7Z0JBQ25CO29CQUNFLElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU07b0JBQ2pDLFFBQVEsRUFBRSxFQUFFO2lCQUNiO2dCQUNEO29CQUNFLElBQUksRUFBRSxTQUFTO29CQUNmLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQjtvQkFDOUMsUUFBUSxFQUFFLEVBQUU7aUJBQ2I7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUVILDJCQUEyQjtRQUMzQixNQUFNLGFBQWEsR0FBRyxJQUFJLEVBQUUsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRTtZQUN6RCxTQUFTLEVBQUUsSUFBSTtZQUNm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Qy9CLFdBQVcsRUFBRSx5REFBeUQ7U0FDdkUsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLFdBQVcsWUFBWSxDQUFDLHNCQUFzQixFQUFFO1lBQ3ZELFdBQVcsRUFBRSw2Q0FBNkM7U0FDM0QsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUM1QyxLQUFLLEVBQUUsWUFBWSxDQUFDLGVBQWUsQ0FBQyxRQUFRO1lBQzVDLFdBQVcsRUFBRSw2QkFBNkI7U0FDM0MsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDckMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxHQUFHO1lBQ2QsV0FBVyxFQUFFLDBCQUEwQjtTQUN4QyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF6aUJELDRDQXlpQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgZG9jZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWRvY2RiJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0ICogYXMgczNkZXBsb3kgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnO1xuaW1wb3J0ICogYXMgY2xvdWRmcm9udCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udCc7XG5pbXBvcnQgKiBhcyBvcmlnaW5zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250LW9yaWdpbnMnO1xuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMnO1xuaW1wb3J0ICogYXMgdGFyZ2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHMnO1xuaW1wb3J0ICogYXMgc2VjcmV0c21hbmFnZXIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNlY3JldHNtYW5hZ2VyJztcbmltcG9ydCAqIGFzIGNyIGZyb20gJ2F3cy1jZGstbGliL2N1c3RvbS1yZXNvdXJjZXMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGNsYXNzIFZpZGVvU2VhcmNoU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyDliJvlu7pWUENcbiAgICBjb25zdCB2cGMgPSBuZXcgZWMyLlZwYyh0aGlzLCAnVmlkZW9TZWFyY2hWUEMnLCB7XG4gICAgICBtYXhBenM6IDIsXG4gICAgICBuYXRHYXRld2F5czogMSxcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdwdWJsaWMnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyxcbiAgICAgICAgICBjaWRyTWFzazogMjRcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdwcml2YXRlJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxuICAgICAgICAgIGNpZHJNYXNrOiAyNFxuICAgICAgICB9XG4gICAgICBdXG4gICAgfSk7XG5cbiAgICAvLyDliJvlu7rljZXkuKpTM+WtmOWCqOahtu+8jOeUqOS6juinhumikei+k+WFpeOAgei+k+WHuuWSjOWJjeerr+aJmOeuoVxuICAgIGNvbnN0IHVuaWZpZWRCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdVbmlmaWVkQnVja2V0Jywge1xuICAgICAgdmVyc2lvbmVkOiB0cnVlLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiB0cnVlLFxuICAgICAgZXZlbnRCcmlkZ2VFbmFibGVkOiB0cnVlLCAvLyDlkK/nlKggRXZlbnRCcmlkZ2Ug6YCa55+lXG4gICAgICBjb3JzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogW3MzLkh0dHBNZXRob2RzLkdFVCwgczMuSHR0cE1ldGhvZHMuUFVULCBzMy5IdHRwTWV0aG9kcy5QT1NUXSxcbiAgICAgICAgICBhbGxvd2VkT3JpZ2luczogWycqJ10sXG4gICAgICAgICAgYWxsb3dlZEhlYWRlcnM6IFsnKiddLFxuICAgICAgICAgIGV4cG9zZWRIZWFkZXJzOiBbJ0VUYWcnLCAnQ29udGVudC1MZW5ndGgnLCAnQ29udGVudC1UeXBlJywgJ0NvbnRlbnQtUmFuZ2UnLCAnQWNjZXB0LVJhbmdlcyddLFxuICAgICAgICAgIG1heEFnZTogMzYwMCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgIH0pO1xuICAgIFxuICAgIC8vIOWIm+W7uiBDbG91ZEZyb250IE9yaWdpbiBBY2Nlc3MgSWRlbnRpdHlcbiAgICBjb25zdCBvcmlnaW5BY2Nlc3NJZGVudGl0eSA9IG5ldyBjbG91ZGZyb250Lk9yaWdpbkFjY2Vzc0lkZW50aXR5KHRoaXMsICdDbG91ZEZyb250T0FJJywge1xuICAgICAgY29tbWVudDogJ09BSSBmb3IgdmlkZW8gc2VhcmNoIGZyb250ZW5kJ1xuICAgIH0pO1xuICAgIFxuICAgIC8vIOaOiOS6iCBPQUkg6K6/6ZeuIFMzIOWtmOWCqOahtueahOadg+mZkFxuICAgIHVuaWZpZWRCdWNrZXQuZ3JhbnRSZWFkKG9yaWdpbkFjY2Vzc0lkZW50aXR5KTtcblxuICAgIC8vIOWIm+W7ukFQSSBHYXRld2F5XG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnVmlkZW9TZWFyY2hBcGknLCB7XG4gICAgICByZXN0QXBpTmFtZTogJ1ZpZGVvIFNlYXJjaCBBUEknLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgZm9yIHNlYXJjaGluZyB2aWRlbyBjb250ZW50JyxcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xuICAgICAgICBhbGxvd09yaWdpbnM6IGFwaWdhdGV3YXkuQ29ycy5BTExfT1JJR0lOUyxcbiAgICAgICAgYWxsb3dNZXRob2RzOiBhcGlnYXRld2F5LkNvcnMuQUxMX01FVEhPRFMsXG4gICAgICAgIGFsbG93SGVhZGVyczogWydDb250ZW50LVR5cGUnLCAnWC1BbXotRGF0ZScsICdBdXRob3JpemF0aW9uJywgJ1gtQXBpLUtleScsICdYLVJlcXVlc3RlZC1XaXRoJywgJ0FjY2VwdCcsICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcycsICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJ10sXG4gICAgICAgIGFsbG93Q3JlZGVudGlhbHM6IHRydWUsXG4gICAgICAgIG1heEFnZTogY2RrLkR1cmF0aW9uLmRheXMoMSksXG4gICAgICB9LFxuICAgICAgZGVwbG95T3B0aW9uczoge1xuICAgICAgICBzdGFnZU5hbWU6ICdwcm9kJyxcbiAgICAgICAgbG9nZ2luZ0xldmVsOiBhcGlnYXRld2F5Lk1ldGhvZExvZ2dpbmdMZXZlbC5JTkZPLFxuICAgICAgICBkYXRhVHJhY2VFbmFibGVkOiB0cnVlLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIOWIm+W7ukFQSSBHYXRld2F555qEQ2xvdWRGcm9udOa6kFxuICAgIGNvbnN0IGFwaU9yaWdpbiA9IG5ldyBvcmlnaW5zLkh0dHBPcmlnaW4oYCR7YXBpLnJlc3RBcGlJZH0uZXhlY3V0ZS1hcGkuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbWAsIHtcbiAgICAgIG9yaWdpblBhdGg6ICcvcHJvZCcsXG4gICAgICBwcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5PcmlnaW5Qcm90b2NvbFBvbGljeS5IVFRQU19PTkxZLFxuICAgIH0pO1xuXG4gICAgLy8g5Yib5bu6Q2xvdWRGcm9udOWIhuWPkVxuICAgIGNvbnN0IGRpc3RyaWJ1dGlvbiA9IG5ldyBjbG91ZGZyb250LkRpc3RyaWJ1dGlvbih0aGlzLCAnRnJvbnRlbmREaXN0cmlidXRpb24nLCB7XG4gICAgICBkZWZhdWx0QmVoYXZpb3I6IHtcbiAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbih1bmlmaWVkQnVja2V0LCB7XG4gICAgICAgICAgb3JpZ2luUGF0aDogJy9mcm9udGVuZCcsIC8vIOaMh+WumuWJjeerr+aWh+S7tueahOi3r+W+hOWJjee8gFxuICAgICAgICAgIG9yaWdpbkFjY2Vzc0lkZW50aXR5OiBvcmlnaW5BY2Nlc3NJZGVudGl0eVxuICAgICAgICB9KSxcbiAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFEX09QVElPTlMsXG4gICAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfT1BUSU1JWkVELFxuICAgICAgfSxcbiAgICAgIC8vIOa3u+WKoOmineWklueahOihjOS4uu+8jOeUqOS6juiuv+mXruinhumikeaWh+S7tlxuICAgICAgYWRkaXRpb25hbEJlaGF2aW9yczoge1xuICAgICAgICAndmlkZW8taW5wdXQvKic6IHtcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKHVuaWZpZWRCdWNrZXQsIHtcbiAgICAgICAgICAgIG9yaWdpbkFjY2Vzc0lkZW50aXR5OiBvcmlnaW5BY2Nlc3NJZGVudGl0eVxuICAgICAgICAgIH0pLFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFEX09QVElPTlMsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19PUFRJTUlaRUQsXG4gICAgICAgICAgcmVzcG9uc2VIZWFkZXJzUG9saWN5OiBuZXcgY2xvdWRmcm9udC5SZXNwb25zZUhlYWRlcnNQb2xpY3kodGhpcywgJ1ZpZGVvSW5wdXRDb3JzUG9saWN5Jywge1xuICAgICAgICAgICAgY29yc0JlaGF2aW9yOiB7XG4gICAgICAgICAgICAgIGFjY2Vzc0NvbnRyb2xBbGxvd09yaWdpbnM6IFsnKiddLFxuICAgICAgICAgICAgICBhY2Nlc3NDb250cm9sQWxsb3dNZXRob2RzOiBbJ0dFVCcsICdIRUFEJywgJ09QVElPTlMnXSxcbiAgICAgICAgICAgICAgYWNjZXNzQ29udHJvbEFsbG93SGVhZGVyczogWycqJ10sXG4gICAgICAgICAgICAgIGFjY2Vzc0NvbnRyb2xNYXhBZ2U6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDM2MDApLFxuICAgICAgICAgICAgICBvcmlnaW5PdmVycmlkZTogdHJ1ZSxcbiAgICAgICAgICAgICAgYWNjZXNzQ29udHJvbEFsbG93Q3JlZGVudGlhbHM6IGZhbHNlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICAgICd2aWRlby1vdXRwdXQvKic6IHtcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKHVuaWZpZWRCdWNrZXQsIHtcbiAgICAgICAgICAgIG9yaWdpbkFjY2Vzc0lkZW50aXR5OiBvcmlnaW5BY2Nlc3NJZGVudGl0eVxuICAgICAgICAgIH0pLFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFEX09QVElPTlMsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19PUFRJTUlaRUQsXG4gICAgICAgICAgcmVzcG9uc2VIZWFkZXJzUG9saWN5OiBuZXcgY2xvdWRmcm9udC5SZXNwb25zZUhlYWRlcnNQb2xpY3kodGhpcywgJ1ZpZGVvT3V0cHV0Q29yc1BvbGljeScsIHtcbiAgICAgICAgICAgIGNvcnNCZWhhdmlvcjoge1xuICAgICAgICAgICAgICBhY2Nlc3NDb250cm9sQWxsb3dPcmlnaW5zOiBbJyonXSxcbiAgICAgICAgICAgICAgYWNjZXNzQ29udHJvbEFsbG93TWV0aG9kczogWydHRVQnLCAnSEVBRCcsICdPUFRJT05TJ10sXG4gICAgICAgICAgICAgIGFjY2Vzc0NvbnRyb2xBbGxvd0hlYWRlcnM6IFsnKiddLFxuICAgICAgICAgICAgICBhY2Nlc3NDb250cm9sTWF4QWdlOiBjZGsuRHVyYXRpb24uc2Vjb25kcygzNjAwKSxcbiAgICAgICAgICAgICAgb3JpZ2luT3ZlcnJpZGU6IHRydWUsXG4gICAgICAgICAgICAgIGFjY2Vzc0NvbnRyb2xBbGxvd0NyZWRlbnRpYWxzOiBmYWxzZVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pLFxuICAgICAgICB9LFxuICAgICAgICAvLyDmt7vliqBBUEnooYzkuLrvvIzlhYHorrjmiYDmnIlIVFRQ5pa55rOV5bm256aB55So57yT5a2YXG4gICAgICAgICdhcGkvKic6IHtcbiAgICAgICAgICBvcmlnaW46IGFwaU9yaWdpbixcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5IVFRQU19PTkxZLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0FMTCwgLy8g5YWB6K645omA5pyJSFRUUOaWueazle+8jOWMheaLrFBPU1RcbiAgICAgICAgICBjYWNoZVBvbGljeTogY2xvdWRmcm9udC5DYWNoZVBvbGljeS5DQUNISU5HX0RJU0FCTEVELCAvLyDnpoHnlKjnvJPlrZhcbiAgICAgICAgICBvcmlnaW5SZXF1ZXN0UG9saWN5OiBjbG91ZGZyb250Lk9yaWdpblJlcXVlc3RQb2xpY3kuQUxMX1ZJRVdFUiwgLy8g6L2s5Y+R5omA5pyJ6K+35rGC5aS05ZKM5p+l6K+i5a2X56ym5LiyXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZGVmYXVsdFJvb3RPYmplY3Q6ICdpbmRleC5odG1sJyxcbiAgICAgIGVycm9yUmVzcG9uc2VzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBodHRwU3RhdHVzOiA0MDQsXG4gICAgICAgICAgcmVzcG9uc2VIdHRwU3RhdHVzOiAyMDAsXG4gICAgICAgICAgcmVzcG9uc2VQYWdlUGF0aDogJy9pbmRleC5odG1sJyxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyDliJvlu7pEb2N1bWVudERC6ZuG576kXG4gICAgY29uc3QgZG9jZGJDbHVzdGVyID0gbmV3IGRvY2RiLkRhdGFiYXNlQ2x1c3Rlcih0aGlzLCAnVmlkZW9EYXRhQ2x1c3RlcicsIHtcbiAgICAgIG1hc3RlclVzZXI6IHtcbiAgICAgICAgdXNlcm5hbWU6ICd1c2VybmFtZTEyMycsXG4gICAgICAgIHBhc3N3b3JkOiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KCdQYXNzd29yZDEyMycpLFxuICAgICAgfSxcbiAgICAgIGluc3RhbmNlVHlwZTogZWMyLkluc3RhbmNlVHlwZS5vZihlYzIuSW5zdGFuY2VDbGFzcy5UMywgZWMyLkluc3RhbmNlU2l6ZS5NRURJVU0pLFxuICAgICAgaW5zdGFuY2VzOiAxLCAvLyDlh4/lsJHlrp7kvovmlbDph4/ku6XliqDlv6vliJ3lp4vljJZcbiAgICAgIHZwY1N1Ym5ldHM6IHtcbiAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgIH0sXG4gICAgICB2cGM6IHZwYyxcbiAgICAgIGRlbGV0aW9uUHJvdGVjdGlvbjogZmFsc2UsIC8vIOS/ruaUueS4umZhbHNl5Lul5L6/5LqO5rWL6K+V546v5aKD5Lit5Yig6ZmkXG4gICAgICBlbmdpbmVWZXJzaW9uOiAnNS4wLjAnLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSwgLy8g5L+u5pS55Li6REVTVFJPWeS7peS+v+S6jua1i+ivleeOr+Wig+S4reWIoOmZpFxuICAgIH0pO1xuICAgIFxuICAgIC8vIOWIm+W7uuWPguaVsOe7hOW5tuW6lOeUqOWIsOmbhue+pFxuICAgIGNvbnN0IGNsdXN0ZXJQYXJhbWV0ZXJHcm91cCA9IG5ldyBkb2NkYi5DZm5EQkNsdXN0ZXJQYXJhbWV0ZXJHcm91cCh0aGlzLCAnVmlkZW9EYXRhQ2x1c3RlclBhcmFtcycsIHtcbiAgICAgIGZhbWlseTogJ2RvY2RiNS4wJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ3VzdG9tIHBhcmFtZXRlciBncm91cCBmb3IgVmlkZW8gU2VhcmNoIGFwcGxpY2F0aW9uJyxcbiAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgJ3Rscyc6ICdkaXNhYmxlZCcgIC8vIOemgeeUqCBUTFMg6KaB5rGCXG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgLy8g6I635Y+W5bqV5bGC55qEIENmbkRCQ2x1c3RlciDotYTmupBcbiAgICBjb25zdCBjZm5DbHVzdGVyID0gZG9jZGJDbHVzdGVyLm5vZGUuZGVmYXVsdENoaWxkIGFzIGRvY2RiLkNmbkRCQ2x1c3RlcjtcbiAgICBcbiAgICAvLyDorr7nva7lj4LmlbDnu4Tlkozml6Xlv5flr7zlh7pcbiAgICBjZm5DbHVzdGVyLmRiQ2x1c3RlclBhcmFtZXRlckdyb3VwTmFtZSA9IGNsdXN0ZXJQYXJhbWV0ZXJHcm91cC5yZWY7XG4gICAgY2ZuQ2x1c3Rlci5lbmFibGVDbG91ZHdhdGNoTG9nc0V4cG9ydHMgPSBbJ2F1ZGl0JywgJ3Byb2ZpbGVyJ107XG5cbiAgICAvLyDliJvlu7pMYW1iZGHmiafooYzop5LoibJcbiAgICBjb25zdCBsYW1iZGFSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdWaWRlb1NlYXJjaExhbWJkYVJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFWUENBY2Nlc3NFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnQW1hem9uUzNSZWFkT25seUFjY2VzcycpLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIOa3u+WKoEJlZHJvY2vmnYPpmZBcbiAgICBsYW1iZGFSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2JlZHJvY2s6KicsXG4gICAgICAgICdiZWRyb2NrLXJ1bnRpbWU6KicsXG4gICAgICAgICdiZWRyb2NrLWRhdGEtYXV0b21hdGlvbjoqJyxcbiAgICAgICAgJ2JlZHJvY2stZGF0YS1hdXRvbWF0aW9uLXJ1bnRpbWU6KicsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG4gICAgXG4gICAgLy8g5re75Yqg5pu05aSa5p2D6ZmQXG4gICAgbGFtYmRhUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZScsXG4gICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcbiAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJyxcbiAgICAgICAgJ2xvZ3M6UHV0TG9nRXZlbnRzJyxcbiAgICAgICAgJ2VjMjpDcmVhdGVOZXR3b3JrSW50ZXJmYWNlJyxcbiAgICAgICAgJ2VjMjpEZXNjcmliZU5ldHdvcmtJbnRlcmZhY2VzJyxcbiAgICAgICAgJ2VjMjpEZWxldGVOZXR3b3JrSW50ZXJmYWNlJ1xuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgLy8g5Yib5bu65a6J5YWo57uEXG4gICAgY29uc3QgbGFtYmRhU0cgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0xhbWJkYVNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGM6IHZwYyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgZm9yIExhbWJkYSBmdW5jdGlvbnMnLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIOWFgeiuuExhbWJkYeiuv+mXrkRvY3VtZW50REJcbiAgICBkb2NkYkNsdXN0ZXIuY29ubmVjdGlvbnMuYWxsb3dGcm9tKGxhbWJkYVNHLCBlYzIuUG9ydC50Y3AoMjcwMTcpKTtcblxuICAgIC8vIOiOt+WPlkRvY3VtZW50RELov57mjqXlr4bpkqVcbiAgICBjb25zdCBkYlNlY3JldCA9IHNlY3JldHNtYW5hZ2VyLlNlY3JldC5mcm9tU2VjcmV0TmFtZVYyKFxuICAgICAgdGhpcywgJ0RvY0RCU2VjcmV0JywgJy92aWRlby1zZWFyY2gvZG9jZGIvbWFzdGVydXNlcidcbiAgICApO1xuXG4gICAgLy8g5p6E5bu6TW9uZ29EQui/nuaOpVVSSVxuICAgIGNvbnN0IG1vbmdvRGJVcmkgPSBgbW9uZ29kYjovL3VzZXJuYW1lMTIzOlBhc3N3b3JkMTIzQCR7ZG9jZGJDbHVzdGVyLmNsdXN0ZXJFbmRwb2ludC5ob3N0bmFtZX06MjcwMTcvP3JlcGxpY2FTZXQ9cnMwJnJlYWRQcmVmZXJlbmNlPXNlY29uZGFyeVByZWZlcnJlZCZyZXRyeVdyaXRlcz1mYWxzZSZzc2w9ZmFsc2VgO1xuXG4gICAgLy8g5Yib5bu6TGFtYmRhIExheWVyXG4gICAgY29uc3QgcHl0aG9uTGF5ZXIgPSBuZXcgbGFtYmRhLkxheWVyVmVyc2lvbih0aGlzLCAnUHl0aG9uRGVwZW5kZW5jaWVzTGF5ZXInLCB7XG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJ2Fzc2V0cy9sYW1iZGEtbGF5ZXInKSksXG4gICAgICBjb21wYXRpYmxlUnVudGltZXM6IFtsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMV0sICAvLyDmlLnkuLogUHl0aG9uIDMuMTFcbiAgICAgIGRlc2NyaXB0aW9uOiAnUHl0aG9uIGRlcGVuZGVuY2llcyBmb3IgTGFtYmRhIGZ1bmN0aW9ucycsXG4gICAgfSk7XG5cbiAgICAvLyDliJvlu7pMYW1iZGHlh73mlbAgLSDmkJzntKLop4bpopFcbiAgICBjb25zdCBzZWFyY2hWaWRlb0Z1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU2VhcmNoVmlkZW9GdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzExLFxuICAgICAgaGFuZGxlcjogJ3NlYXJjaF92aWRlby5sYW1iZGFfaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJ2Fzc2V0cy9sYW1iZGEvc2VhcmNoLXZpZGVvJykpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgdnBjOiB2cGMsXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLCAvLyDkvb/nlKjlt7LlrprkuYnnmoTlhbfmnIlCZWRyb2Nr5p2D6ZmQ55qE6KeS6ImyXG4gICAgICBzZWN1cml0eUdyb3VwczogW2xhbWJkYVNHXSxcbiAgICAgIHZwY1N1Ym5ldHM6IHtcbiAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgIH0sXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAnREJfRU5EUE9JTlQnOiBkb2NkYkNsdXN0ZXIuY2x1c3RlckVuZHBvaW50Lmhvc3RuYW1lLFxuICAgICAgICAnREJfUE9SVCc6ICcyNzAxNycsXG4gICAgICAgICdEQl9VU0VSTkFNRSc6ICd1c2VybmFtZTEyMycsXG4gICAgICAgICdEQl9QQVNTV09SRCc6ICdQYXNzd29yZDEyMycsXG4gICAgICAgICdEQl9OQU1FJzogJ1ZpZGVvRGF0YScsXG4gICAgICAgICdDT0xMRUNUSU9OX05BTUUnOiAndmlkZW9kYXRhJyxcbiAgICAgICAgJ0RFUExPWV9SRUdJT04nOiB0aGlzLnJlZ2lvbiwgLy8g5L2/55SoIERFUExPWV9SRUdJT04g6ICM5LiN5pivIEFXU19SRUdJT05cbiAgICAgICAgJ0xPR19MRVZFTCc6ICdERUJVRycsICAvLyDorr7nva7ml6Xlv5fnuqfliKtcbiAgICAgIH0sXG4gICAgICBsYXllcnM6IFtweXRob25MYXllcl0sIC8vIOa3u+WKoExheWVyXG4gICAgfSk7XG5cbiAgICAvLyDliJvlu7pMYW1iZGHlh73mlbAgLSDmj5Dlj5bop4bpopHmlbDmja5cbiAgICBjb25zdCBleHRyYWN0VmlkZW9EYXRhRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdFeHRyYWN0VmlkZW9EYXRhRnVuY3Rpb24nLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMSxcbiAgICAgIGhhbmRsZXI6ICdsYW1iZGFfZnVuY3Rpb24ubGFtYmRhX2hhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICdhc3NldHMvbGFtYmRhL2V4dHJhY3QtdmlkZW8tZGF0YScpKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwMCksXG4gICAgICBtZW1vcnlTaXplOiAxMDI0LFxuICAgICAgdnBjOiB2cGMsXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLCAvLyDkvb/nlKjlt7LlrprkuYnnmoTlhbfmnIlCZWRyb2Nr5p2D6ZmQ55qE6KeS6ImyXG4gICAgICBzZWN1cml0eUdyb3VwczogW2xhbWJkYVNHXSxcbiAgICAgIHZwY1N1Ym5ldHM6IHtcbiAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgIH0sXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAnREJfRU5EUE9JTlQnOiBkb2NkYkNsdXN0ZXIuY2x1c3RlckVuZHBvaW50Lmhvc3RuYW1lLFxuICAgICAgICAnREJfUE9SVCc6ICcyNzAxNycsXG4gICAgICAgICdEQl9VU0VSTkFNRSc6ICd1c2VybmFtZTEyMycsXG4gICAgICAgICdEQl9QQVNTV09SRCc6ICdQYXNzd29yZDEyMycsXG4gICAgICAgICdEQl9OQU1FJzogJ1ZpZGVvRGF0YScsXG4gICAgICAgICdDT0xMRUNUSU9OX05BTUUnOiAndmlkZW9kYXRhJyxcbiAgICAgICAgJ0RFUExPWV9SRUdJT04nOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgJ0xPR19MRVZFTCc6ICdERUJVRycsXG4gICAgICAgICdCVUNLRVRfTkFNRSc6IHVuaWZpZWRCdWNrZXQuYnVja2V0TmFtZSwgLy8g5L2/55So57uf5LiA5a2Y5YKo5qG2XG4gICAgICB9LFxuICAgICAgbGF5ZXJzOiBbcHl0aG9uTGF5ZXJdLCAvLyDmt7vliqBMYXllclxuICAgIH0pO1xuXG4gICAgLy8g5Yib5bu6IEJEQSDpobnnm67nmoQgTGFtYmRhIOWHveaVsFxuICAgIGNvbnN0IGNyZWF0ZUJEQVByb2plY3RGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0NyZWF0ZUJEQVByb2plY3RGdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzExLFxuICAgICAgaGFuZGxlcjogJ2NyZWF0ZV9iZGFfcHJvamVjdC5sYW1iZGFfaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJ2Fzc2V0cy9sYW1iZGEvY3JlYXRlLWJkYS1wcm9qZWN0JykpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNjApLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgcm9sZTogbGFtYmRhUm9sZSwgLy8g5L2/55So5bey5a6a5LmJ55qE5YW35pyJQmVkcm9ja+adg+mZkOeahOinkuiJslxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgJ1BST0pFQ1RfTkFNRSc6ICdWaWRlb0RhdGFQcm9qZWN0JyxcbiAgICAgICAgJ0RFUExPWV9SRUdJT04nOiB0aGlzLnJlZ2lvbixcbiAgICAgIH0sXG4gICAgICBsYXllcnM6IFtweXRob25MYXllcl0sIC8vIOa3u+WKoExheWVyXG4gICAgfSk7XG5cbiAgICAvLyDliJvlu7roh6rlrprkuYnotYTmupDmnaXnoa7kv53lnKjpg6jnvbLml7bliJvlu7ogQkRBIOmhueebrlxuICAgIGNvbnN0IGJkYVByb2plY3RQcm92aWRlciA9IG5ldyBjci5Qcm92aWRlcih0aGlzLCAnQkRBUHJvamVjdFByb3ZpZGVyJywge1xuICAgICAgb25FdmVudEhhbmRsZXI6IGNyZWF0ZUJEQVByb2plY3RGdW5jdGlvbixcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ3VzdG9tUmVzb3VyY2UodGhpcywgJ0JEQVByb2plY3QnLCB7XG4gICAgICBzZXJ2aWNlVG9rZW46IGJkYVByb2plY3RQcm92aWRlci5zZXJ2aWNlVG9rZW4sXG4gICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgIC8vIOa3u+WKoOaXtumXtOaIs+WxnuaAp++8jOehruS/neavj+asoemDqOe9sumDveS8muinpuWPkVxuICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyDliJvlu7pMYW1iZGHlh73mlbAgLSDop6blj5Hop4bpopHmlbDmja7oh6rliqjljJZcbiAgICBjb25zdCB0cmlnZ2VyVmlkZW9EYXRhQXV0b21hdGlvbkZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnVHJpZ2dlclZpZGVvRGF0YUF1dG9tYXRpb25GdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzExLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmxhbWJkYV9oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnYXNzZXRzL2xhbWJkYS90cmlnZ2VyLXZpZGVvLWRhdGEtYXV0b21hdGlvbicpKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIHJvbGU6IGxhbWJkYVJvbGUsIC8vIOS9v+eUqOW3suWumuS5ieeahOWFt+aciUJlZHJvY2vmnYPpmZDnmoTop5LoibJcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICdCREFfUlVOVElNRV9FTkRQT0lOVCc6IGBodHRwczovL2JlZHJvY2stZGF0YS1hdXRvbWF0aW9uLXJ1bnRpbWUuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbWAsXG4gICAgICAgICdEQVRBX1BST0pFQ1RfTkFNRSc6ICdWaWRlb0RhdGFQcm9qZWN0JyxcbiAgICAgICAgJ1RBUkdFVF9CVUNLRVRfTkFNRSc6IHVuaWZpZWRCdWNrZXQuYnVja2V0TmFtZSwgLy8g5L2/55So57uf5LiA5a2Y5YKo5qG2XG4gICAgICAgICdERVBMT1lfUkVHSU9OJzogdGhpcy5yZWdpb24sXG4gICAgICB9LFxuICAgICAgbGF5ZXJzOiBbcHl0aG9uTGF5ZXJdLCAvLyDmt7vliqBMYXllclxuICAgIH0pO1xuXG4gICAgLy8g5o6I5LqIUzPor7vlhpnmnYPpmZBcbiAgICB1bmlmaWVkQnVja2V0LmdyYW50UmVhZCh0cmlnZ2VyVmlkZW9EYXRhQXV0b21hdGlvbkZ1bmN0aW9uKTtcbiAgICB1bmlmaWVkQnVja2V0LmdyYW50UmVhZFdyaXRlKGV4dHJhY3RWaWRlb0RhdGFGdW5jdGlvbik7XG5cbiAgICAvLyDlhYHorrhEb2N1bWVudERC5a+G6ZKl6K6/6ZeuXG4gICAgZGJTZWNyZXQuZ3JhbnRSZWFkKHNlYXJjaFZpZGVvRnVuY3Rpb24pO1xuICAgIGRiU2VjcmV0LmdyYW50UmVhZChleHRyYWN0VmlkZW9EYXRhRnVuY3Rpb24pO1xuXG4gICAgLy8g5Yib5bu65Yid5aeL5YyW5pWw5o2u5bqT55qETGFtYmRh5Ye95pWwXG4gICAgY29uc3QgaW5pdERiRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdJbml0RGJGdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzExLFxuICAgICAgaGFuZGxlcjogJ2luaXRfZGIubGFtYmRhX2hhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICdhc3NldHMvbGFtYmRhL2luaXQtZGInKSksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MDApLCAvLyDlop7liqDliLAgMTAg5YiG6ZKfXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgICB2cGM6IHZwYyxcbiAgICAgIHJvbGU6IGxhbWJkYVJvbGUsIC8vIOS9v+eUqOW3suWumuS5ieeahOWFt+aciUJlZHJvY2vmnYPpmZDnmoTop5LoibJcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbbGFtYmRhU0ddLFxuICAgICAgdnBjU3VibmV0czoge1xuICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxuICAgICAgfSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICdEQl9FTkRQT0lOVCc6IGRvY2RiQ2x1c3Rlci5jbHVzdGVyRW5kcG9pbnQuaG9zdG5hbWUsXG4gICAgICAgICdEQl9QT1JUJzogJzI3MDE3JyxcbiAgICAgICAgJ0RCX1VTRVJOQU1FJzogJ3VzZXJuYW1lMTIzJyxcbiAgICAgICAgJ0RCX1BBU1NXT1JEJzogJ1Bhc3N3b3JkMTIzJyxcbiAgICAgICAgJ0RCX05BTUUnOiAnVmlkZW9EYXRhJyxcbiAgICAgICAgJ0NPTExFQ1RJT05fTkFNRSc6ICd2aWRlb2RhdGEnLFxuICAgICAgICAnREVQTE9ZX1JFR0lPTic6IHRoaXMucmVnaW9uLCAvLyDkvb/nlKggREVQTE9ZX1JFR0lPTiDogIzkuI3mmK8gQVdTX1JFR0lPTlxuICAgICAgICAnTE9HX0xFVkVMJzogJ0RFQlVHJywgIC8vIOiuvue9ruaXpeW/l+e6p+WIq1xuICAgICAgfSxcbiAgICAgIGxheWVyczogW3B5dGhvbkxheWVyXSwgLy8g5re75YqgTGF5ZXJcbiAgICB9KTtcblxuICAgIC8vIOaOiOS6iERvY3VtZW50RELlr4bpkqXorr/pl67mnYPpmZBcbiAgICBkYlNlY3JldC5ncmFudFJlYWQoaW5pdERiRnVuY3Rpb24pO1xuXG4gICAgLy8g5Yib5bu66Ieq5a6a5LmJ6LWE5rqQ5p2l56Gu5L+d5Zyo6YOo572y5pe26L+Q6KGM5Yid5aeL5YyWXG4gICAgY29uc3QgZGJJbml0aWFsaXplclByb3ZpZGVyID0gbmV3IGNyLlByb3ZpZGVyKHRoaXMsICdEYkluaXRpYWxpemVyUHJvdmlkZXInLCB7XG4gICAgICBvbkV2ZW50SGFuZGxlcjogaW5pdERiRnVuY3Rpb24sXG4gICAgICAvLyDnp7vpmaQgdG90YWxUaW1lb3V0IOWPguaVsO+8jOWboOS4uuaIkeS7rOayoeacieaPkOS+myBpc0NvbXBsZXRlSGFuZGxlclxuICAgIH0pO1xuICAgIFxuICAgIC8vIOehruS/nSBQcm92aWRlciDlnKggRG9jdW1lbnREQiDpm4bnvqTlj6/nlKjlkI7miY3ov5DooYxcbiAgICBkYkluaXRpYWxpemVyUHJvdmlkZXIubm9kZS5hZGREZXBlbmRlbmN5KGRvY2RiQ2x1c3Rlcik7XG4gICAgXG4gICAgbmV3IGNkay5DdXN0b21SZXNvdXJjZSh0aGlzLCAnRGJJbml0aWFsaXplcicsIHtcbiAgICAgIHNlcnZpY2VUb2tlbjogZGJJbml0aWFsaXplclByb3ZpZGVyLnNlcnZpY2VUb2tlbixcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgLy8g5re75Yqg5pe26Ze05oiz5bGe5oCn77yM56Gu5L+d5q+P5qyh6YOo572y6YO95Lya6Kem5Y+RXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIOWIm+W7ukFQSei1hOa6kOWSjOaWueazlVxuICAgIGNvbnN0IHNlYXJjaFJlc291cmNlID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ3NlYXJjaCcpO1xuICAgIFxuICAgIC8vIOa3u+WKoFBPU1Tmlrnms5XvvIzpm4bmiJBMYW1iZGHlh73mlbBcbiAgICBzZWFyY2hSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihzZWFyY2hWaWRlb0Z1bmN0aW9uLCB7XG4gICAgICBwcm94eTogdHJ1ZSxcbiAgICAgIGludGVncmF0aW9uUmVzcG9uc2VzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiAnMjAwJyxcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IFwiJyonXCIsXG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogXCInQ29udGVudC1UeXBlLFgtQW16LURhdGUsQXV0aG9yaXphdGlvbixYLUFwaS1LZXksWC1SZXF1ZXN0ZWQtV2l0aCxBY2NlcHQnXCIsXG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogXCInT1BUSU9OUyxQT1NULEdFVCdcIixcbiAgICAgICAgICB9LFxuICAgICAgICB9XG4gICAgICBdLFxuICAgIH0pLCB7XG4gICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICAgIHJlc3BvbnNlUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogdHJ1ZSxcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiB0cnVlLFxuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfVxuICAgICAgXVxuICAgIH0pO1xuXG4gICAgLy8g6YOo572y5YmN56uv6Z2Z5oCB6LWE5rqQ77yI5LiN5YyF5ousY29uZmlnLmpz77yJXG4gICAgY29uc3QgZnJvbnRlbmREZXBsb3ltZW50ID0gbmV3IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgJ0RlcGxveUZyb250ZW5kU3RhdGljJywge1xuICAgICAgc291cmNlczogW3MzZGVwbG95LlNvdXJjZS5hc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnYXNzZXRzL2Zyb250ZW5kJyksIHtcbiAgICAgICAgZXhjbHVkZTogWydjb25maWcuanMnLCAndXBkYXRlLWNkay5tZCddIC8vIOaOkumZpCBjb25maWcuanMg5ZKM5LiN6ZyA6KaB55qE5paH5qGj5paH5Lu2XG4gICAgICB9KV0sXG4gICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogdW5pZmllZEJ1Y2tldCxcbiAgICAgIGRlc3RpbmF0aW9uS2V5UHJlZml4OiAnZnJvbnRlbmQnLFxuICAgICAgcHJ1bmU6IHRydWUsIC8vIOWIoOmZpOebruagh+S4reS4jeWtmOWcqOS6jua6kOS4reeahOaWh+S7tlxuICAgICAgcmV0YWluT25EZWxldGU6IGZhbHNlLCAvLyDliKDpmaTloIbmoIjml7bliKDpmaTmlofku7ZcbiAgICAgIGRpc3RyaWJ1dGlvbiwgLy8g5re75YqgIENsb3VkRnJvbnQg5YiG5Y+RXG4gICAgICBkaXN0cmlidXRpb25QYXRoczogWycvKiddLCAvLyDkvb/miYDmnInot6/lvoTnmoTnvJPlrZjlpLHmlYhcbiAgICAgIG1lbW9yeUxpbWl0OiAxMDI0LCAvLyDlop7liqDliLAgMTAyNE1CXG4gICAgICB1c2VFZnM6IGZhbHNlLFxuICAgICAgdnBjOiB1bmRlZmluZWQsXG4gICAgICBlcGhlbWVyYWxTdG9yYWdlU2l6ZTogY2RrLlNpemUubWViaWJ5dGVzKDIwNDgpLCAvLyDlop7liqDliLAgMkdCXG4gICAgfSk7XG5cbiAgICAvLyDnoa7kv53liY3nq6/pnZnmgIHotYTmupDpg6jnvbLlnKhTM+WtmOWCqOahtuWIm+W7uuWQjuaJp+ihjFxuICAgIGZyb250ZW5kRGVwbG95bWVudC5ub2RlLmFkZERlcGVuZGVuY3kodW5pZmllZEJ1Y2tldCk7XG4gICAgXG4gICAgLy8g56Gu5L+d5YmN56uv6YOo572y5ZyoQVBJIEdhdGV3YXnlkoxDbG91ZEZyb2505Yib5bu65ZCO5omn6KGMXG4gICAgZnJvbnRlbmREZXBsb3ltZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShhcGkpO1xuICAgIGZyb250ZW5kRGVwbG95bWVudC5ub2RlLmFkZERlcGVuZGVuY3koZGlzdHJpYnV0aW9uKTtcblxuICAgIC8vIOWIm+W7uuS4gOS4quWMheWQq0FQSSBHYXRld2F5IFVSTOWSjENsb3VkRnJvbnQgVVJM55qEY29uZmlnLmpz5paH5Lu2XG4gICAgY29uc3QgY29uZmlnRmlsZUNvbnRlbnQgPSBgd2luZG93LkNPTkZJRyA9IHtcbiAgQVBJX0VORFBPSU5UOiAnaHR0cHM6Ly8ke2FwaS5yZXN0QXBpSWR9LmV4ZWN1dGUtYXBpLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb20vcHJvZCcsXG4gIENMT1VERlJPTlRfVVJMOiAnaHR0cHM6Ly8ke2Rpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lfScsXG4gIFZJREVPX0JBU0VfVVJMOiAnaHR0cHM6Ly8ke2Rpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lfS92aWRlby1pbnB1dCdcbn07YDtcblxuICAgIC8vIOmDqOe9sumFjee9ruaWh+S7tu+8iOWcqEFQSSBHYXRld2F55ZKMQ2xvdWRGcm9udOWIm+W7uuWQju+8iVxuICAgIGNvbnN0IGNvbmZpZ0RlcGxveW1lbnQgPSBuZXcgczNkZXBsb3kuQnVja2V0RGVwbG95bWVudCh0aGlzLCAnRGVwbG95RnJvbnRlbmRDb25maWcnLCB7XG4gICAgICBzb3VyY2VzOiBbczNkZXBsb3kuU291cmNlLmRhdGEoJ2NvbmZpZy5qcycsIGNvbmZpZ0ZpbGVDb250ZW50KV0sXG4gICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogdW5pZmllZEJ1Y2tldCxcbiAgICAgIGRlc3RpbmF0aW9uS2V5UHJlZml4OiAnZnJvbnRlbmQnLFxuICAgICAgZGlzdHJpYnV0aW9uLFxuICAgICAgZGlzdHJpYnV0aW9uUGF0aHM6IFsnL2NvbmZpZy5qcyddLCAvLyDlj6rkvb9jb25maWcuanPnvJPlrZjlpLHmlYhcbiAgICAgIG1lbW9yeUxpbWl0OiA1MTIsIC8vIOWinuWKoOWGheWtmOmZkOWItlxuICAgICAgdXNlRWZzOiBmYWxzZSxcbiAgICAgIHZwYzogdW5kZWZpbmVkLFxuICAgICAgZXBoZW1lcmFsU3RvcmFnZVNpemU6IGNkay5TaXplLm1lYmlieXRlcygxMDI0KSwgLy8g5aKe5Yqg5Li05pe25a2Y5YKo56m66Ze0XG4gICAgICBwcnVuZTogZmFsc2UsIC8vIOWFs+mUruS/ruaUue+8muS4jeWIoOmZpOWFtuS7luaWh+S7tlxuICAgIH0pO1xuICAgIFxuICAgIC8vIOehruS/nemFjee9ruaWh+S7tumDqOe9suWcqEFQSSBHYXRld2F55ZKMQ2xvdWRGcm9udOWIm+W7uuWQjuaJp+ihjFxuICAgIGNvbmZpZ0RlcGxveW1lbnQubm9kZS5hZGREZXBlbmRlbmN5KGFwaSk7XG4gICAgY29uZmlnRGVwbG95bWVudC5ub2RlLmFkZERlcGVuZGVuY3koZGlzdHJpYnV0aW9uKTtcblxuICAgIC8vIOWIm+W7unZpZGVvLWlucHV05ZKMdmlkZW8tb3V0cHV05paH5Lu25aS5XG4gICAgY29uc3QgdmlkZW9JbnB1dEZvbGRlciA9IG5ldyBzM2RlcGxveS5CdWNrZXREZXBsb3ltZW50KHRoaXMsICdDcmVhdGVWaWRlb0ZvbGRlcnMnLCB7XG4gICAgICBzb3VyY2VzOiBbczNkZXBsb3kuU291cmNlLmRhdGEoJ3ZpZGVvLWlucHV0LXRlc3QnLCAnJyldLFxuICAgICAgZGVzdGluYXRpb25CdWNrZXQ6IHVuaWZpZWRCdWNrZXQsXG4gICAgICBkZXN0aW5hdGlvbktleVByZWZpeDogJ3ZpZGVvLWlucHV0LycsXG4gICAgICBtZW1vcnlMaW1pdDogNTEyLFxuICAgICAgdXNlRWZzOiBmYWxzZSxcbiAgICAgIHZwYzogdW5kZWZpbmVkLFxuICAgICAgZXBoZW1lcmFsU3RvcmFnZVNpemU6IGNkay5TaXplLm1lYmlieXRlcygxMDI0KSxcbiAgICB9KTtcbiAgICBcbiAgICBjb25zdCB2aWRlb091dHB1dEZvbGRlciA9IG5ldyBzM2RlcGxveS5CdWNrZXREZXBsb3ltZW50KHRoaXMsICdDcmVhdGVWaWRlb091dHB1dEZvbGRlcicsIHtcbiAgICAgIHNvdXJjZXM6IFtzM2RlcGxveS5Tb3VyY2UuZGF0YSgndmlkZW8tb3V0cHV0LXRlc3QnLCAnJyldLFxuICAgICAgZGVzdGluYXRpb25CdWNrZXQ6IHVuaWZpZWRCdWNrZXQsXG4gICAgICBkZXN0aW5hdGlvbktleVByZWZpeDogJ3ZpZGVvLW91dHB1dC8nLFxuICAgICAgbWVtb3J5TGltaXQ6IDUxMixcbiAgICAgIHVzZUVmczogZmFsc2UsXG4gICAgICB2cGM6IHVuZGVmaW5lZCxcbiAgICAgIGVwaGVtZXJhbFN0b3JhZ2VTaXplOiBjZGsuU2l6ZS5tZWJpYnl0ZXMoMTAyNCksXG4gICAgfSk7XG4gICAgXG4gICAgLy8g6L6T5Ye6Q2xvdWRGcm9udCBVUkxcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRnJvbnRlbmRVUkwnLCB7XG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHtkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdVUkwgZm9yIHRoZSBmcm9udGVuZCBhcHBsaWNhdGlvbicsXG4gICAgfSk7XG5cbiAgICAvLyDliJvlu7pFdmVudEJyaWRnZeinhOWImSAtIOebkeWQrFMz6KeG6aKR5LiK5LygXG4gICAgY29uc3QgdmlkZW9VcGxvYWRSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdWaWRlb1VwbG9hZFJ1bGUnLCB7XG4gICAgICBldmVudFBhdHRlcm46IHtcbiAgICAgICAgc291cmNlOiBbJ2F3cy5zMyddLFxuICAgICAgICBkZXRhaWxUeXBlOiBbJ09iamVjdCBDcmVhdGVkJ10sXG4gICAgICAgIGRldGFpbDoge1xuICAgICAgICAgIGJ1Y2tldDoge1xuICAgICAgICAgICAgbmFtZTogW3VuaWZpZWRCdWNrZXQuYnVja2V0TmFtZV0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBvYmplY3Q6IHtcbiAgICAgICAgICAgIGtleTogW3tcbiAgICAgICAgICAgICAgcHJlZml4OiAndmlkZW8taW5wdXQvJyxcbiAgICAgICAgICAgIH1dLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8g5re75YqgTGFtYmRh55uu5qCHXG4gICAgdmlkZW9VcGxvYWRSdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbih0cmlnZ2VyVmlkZW9EYXRhQXV0b21hdGlvbkZ1bmN0aW9uKSk7XG5cbiAgICAvLyDliJvlu7pFdmVudEJyaWRnZeinhOWImSAtIOebkeWQrFMz6KeG6aKR6L6T5Ye657uT5p6c5paH5Lu2XG4gICAgY29uc3QgczNWaWRlb0RhdGFFeHRyYWN0UnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnUzNWaWRlb0RhdGFFeHRyYWN0UnVsZScsIHtcbiAgICAgIHJ1bGVOYW1lOiAnczMtdmlkZW8tZGF0YS1leHRyYWN0JyxcbiAgICAgIGV2ZW50UGF0dGVybjoge1xuICAgICAgICBzb3VyY2U6IFsnYXdzLnMzJ10sXG4gICAgICAgIGRldGFpbFR5cGU6IFsnT2JqZWN0IENyZWF0ZWQnXSxcbiAgICAgICAgZGV0YWlsOiB7XG4gICAgICAgICAgYnVja2V0OiB7XG4gICAgICAgICAgICBuYW1lOiBbdW5pZmllZEJ1Y2tldC5idWNrZXROYW1lXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIG9iamVjdDoge1xuICAgICAgICAgICAga2V5OiBbe1xuICAgICAgICAgICAgICB3aWxkY2FyZDogJ3ZpZGVvLW91dHB1dC8qL3Jlc3VsdC5qc29uJyxcbiAgICAgICAgICAgIH1dLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8g5re75YqgTGFtYmRh55uu5qCHXG4gICAgczNWaWRlb0RhdGFFeHRyYWN0UnVsZS5hZGRUYXJnZXQobmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24oZXh0cmFjdFZpZGVvRGF0YUZ1bmN0aW9uKSk7XG5cbiAgICAvLyDovpPlh7rph43opoHotYTmupDkv6Hmga9cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVW5pZmllZEJ1Y2tldE5hbWUnLCB7XG4gICAgICB2YWx1ZTogdW5pZmllZEJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdTMyBidWNrZXQgZm9yIHZpZGVvIGlucHV0LCBvdXRwdXQsIGFuZCBmcm9udGVuZCBob3N0aW5nJyxcbiAgICB9KTtcbiAgICBcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2xvdWRGcm9udFVSTCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke2Rpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkRnJvbnQgVVJMIGZvciB0aGUgZnJvbnRlbmQgYXBwbGljYXRpb24nLFxuICAgIH0pO1xuICAgIFxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEb2N1bWVudERCRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogZG9jZGJDbHVzdGVyLmNsdXN0ZXJFbmRwb2ludC5ob3N0bmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRG9jdW1lbnREQiBjbHVzdGVyIGVuZHBvaW50JyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlFbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiBhcGkudXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgR2F0ZXdheSBlbmRwb2ludCBVUkwnLFxuICAgIH0pO1xuICB9XG59XG4iXX0=