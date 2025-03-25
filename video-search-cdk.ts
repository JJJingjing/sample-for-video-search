#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { VideoSearchStack } from './video-search-stack';
import * as process from 'process';

const app = new cdk.App();

// 获取命令行参数中的区域
// CDK_DEPLOY_REGION 环境变量会被 --region 参数设置
const region = process.env.CDK_DEPLOY_REGION || 'us-west-2';
console.log(`Using region from command line: ${region}`);

// 使用包含区域的堆栈名称，避免跨区域冲突
const stackName = `VideoSearchStack-${region.replace(/-/g, '')}`;

// 创建单一堆栈包含所有资源
new VideoSearchStack(app, stackName, {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: region 
  },
  description: `Video Search application deployed in ${region}`,
});

// 输出当前使用的区域和堆栈名称，便于调试
console.log(`Deploying stack ${stackName} to region: ${region}`);
