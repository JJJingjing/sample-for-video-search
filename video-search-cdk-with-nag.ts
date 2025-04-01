#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { VideoSearchStack } from './video-search-stack';
import * as process from 'process';
// 导入 CDK-nag
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';

const app = new cdk.App();

// 获取命令行参数中的区域
// CDK_DEPLOY_REGION 环境变量会被 --region 参数设置
const region = process.env.CDK_DEPLOY_REGION || 'us-west-2';
console.log(`Using region from command line: ${region}`);

// 使用包含区域的堆栈名称，避免跨区域冲突
const stackName = `VideoSearchStack-${region.replace(/-/g, '')}`;

// 创建单一堆栈包含所有资源
const stack = new VideoSearchStack(app, stackName, {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: region 
  },
  description: `Video Search application deployed in ${region}`,
});

// 将 CDK-nag 检查应用到所有堆栈
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// 抑制特定规则（如果有合理理由）
NagSuppressions.addStackSuppressions(stack, [
  { id: 'AwsSolutions-IAM4', reason: '使用 AWS 托管策略是此用例的合理选择，这是一个演示项目' },
  { id: 'AwsSolutions-IAM5', reason: '这是一个演示项目，在生产环境中会更严格限制权限' },
  // DocumentDB相关规则抑制
  { id: 'AwsSolutions-DOC2', reason: '这是一个演示项目，在生产环境中会使用非默认端口' },
  { id: 'AwsSolutions-DOC3', reason: '这是一个演示项目，在生产环境中会使用Secrets Manager存储凭据' },
  { id: 'AwsSolutions-DOC4', reason: '这是一个演示项目，在生产环境中会配置合理的备份保留期' },
  { id: 'AwsSolutions-DOC5', reason: '这是一个演示项目，在生产环境中会启用必要的日志导出' },
  // S3相关规则抑制
  { id: 'AwsSolutions-S1', reason: '这是一个演示项目，在生产环境中会启用服务器访问日志' },
  { id: 'AwsSolutions-S10', reason: '这是一个演示项目，在生产环境中会要求使用SSL连接' },
  // API Gateway相关规则抑制
  { id: 'AwsSolutions-APIG2', reason: '这是一个演示项目，在生产环境中会启用请求验证' },
  { id: 'AwsSolutions-APIG3', reason: '这是一个演示项目，在生产环境中会关联WAF' },
  { id: 'AwsSolutions-APIG4', reason: '这是一个演示项目，在生产环境中会实现授权' },
  { id: 'AwsSolutions-COG4', reason: '这是一个演示项目，在生产环境中会使用Cognito用户池授权器' }
]);

// 为特定资源添加抑制规则
NagSuppressions.addResourceSuppressions(stack, [
  // DocumentDB资源抑制
  {
    id: 'AwsSolutions-DOC2',
    reason: '这是一个演示项目，在生产环境中会使用非默认端口',
    appliesTo: ['Resource::VideoDataCluster']
  },
  {
    id: 'AwsSolutions-DOC3',
    reason: '这是一个演示项目，在生产环境中会使用Secrets Manager存储凭据',
    appliesTo: ['Resource::VideoDataCluster']
  },
  {
    id: 'AwsSolutions-DOC4',
    reason: '这是一个演示项目，在生产环境中会配置合理的备份保留期',
    appliesTo: ['Resource::VideoDataCluster']
  },
  {
    id: 'AwsSolutions-DOC5',
    reason: '这是一个演示项目，在生产环境中会启用必要的日志导出',
    appliesTo: [
      'LogExport::authenticate',
      'LogExport::createIndex',
      'LogExport::dropCollection'
    ]
  },
  // S3资源抑制
  {
    id: 'AwsSolutions-S1',
    reason: '这是一个演示项目，在生产环境中会启用服务器访问日志',
    appliesTo: ['Resource::UnifiedBucket']
  },
  {
    id: 'AwsSolutions-S10',
    reason: '这是一个演示项目，在生产环境中会要求使用SSL连接',
    appliesTo: ['Resource::UnifiedBucket', 'Resource::UnifiedBucket/Policy/Resource']
  }
], true);

// 输出当前使用的区域和堆栈名称，便于调试
console.log(`Deploying stack ${stackName} to region: ${region}`);
