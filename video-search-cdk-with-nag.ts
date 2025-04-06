#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { VideoSearchStack } from './video-search-stack';
import * as process from 'process';
// Import CDK-nag
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';

const app = new cdk.App();

// Get region from command line arguments
// CDK_DEPLOY_REGION environment variable is set by the --region parameter
const region = process.env.CDK_DEPLOY_REGION || 'us-west-2';
console.log(`Using region from command line: ${region}`);

// Use stack name with region to avoid cross-region conflicts
const stackName = `VideoSearchStack-${region.replace(/-/g, '')}`;

// Create a single stack containing all resources
const stack = new VideoSearchStack(app, stackName, {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: region 
  },
  description: `Video Search application deployed in ${region}`,
});

// Apply CDK-nag checks to all stacks
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// Suppress specific rules (if there are reasonable justifications)
NagSuppressions.addStackSuppressions(stack, [
  { id: 'AwsSolutions-IAM4', reason: 'Using AWS managed policies is a reasonable choice for this use case, as this is a demo project' },
  { id: 'AwsSolutions-IAM5', reason: 'This is a demo project, permissions would be more strictly limited in a production environment' },
  // VPC related rule suppressions
  { id: 'AwsSolutions-VPC7', reason: 'This is a demo project, VPC flow logs would be enabled in a production environment' },
  // DocumentDB related rule suppressions
  { id: 'AwsSolutions-DOC2', reason: 'This is a demo project, non-default ports would be used in a production environment' },
  { id: 'AwsSolutions-DOC3', reason: 'This is a demo project, Secrets Manager would be used to store credentials in a production environment' },
  { id: 'AwsSolutions-DOC4', reason: 'This is a demo project, reasonable backup retention periods would be configured in a production environment' },
  { id: 'AwsSolutions-DOC5', reason: 'This is a demo project, necessary log exports would be enabled in a production environment' },
  // S3 related rule suppressions
  { id: 'AwsSolutions-S1', reason: 'This is a demo project, server access logs would be enabled in a production environment' },
  { id: 'AwsSolutions-S10', reason: 'This is a demo project, SSL connections would be required in a production environment' },
  // API Gateway related rule suppressions
  { id: 'AwsSolutions-APIG1', reason: 'This is a demo project, API access logs would be enabled in a production environment' },
  { id: 'AwsSolutions-APIG2', reason: 'This is a demo project, request validation would be enabled in a production environment' },
  { id: 'AwsSolutions-APIG3', reason: 'This is a demo project, WAF would be associated in a production environment' },
  { id: 'AwsSolutions-APIG4', reason: 'This is a demo project, authorization would be implemented in a production environment' },
  { id: 'AwsSolutions-COG4', reason: 'This is a demo project, Cognito user pool authorizers would be used in a production environment' },
  // CloudFront related rule suppressions
  { id: 'AwsSolutions-CFR1', reason: 'This is a demo project, geographic restrictions would be added based on business requirements in a production environment' },
  { id: 'AwsSolutions-CFR2', reason: 'This is a demo project, integration with AWS WAF would be implemented in a production environment' },
  { id: 'AwsSolutions-CFR3', reason: 'This is a demo project, CloudFront access logs would be enabled in a production environment' },
  { id: 'AwsSolutions-CFR4', reason: 'This is a demo project, more secure TLS versions would be used in a production environment' },
  // Lambda related rule suppressions
  { id: 'AwsSolutions-L1', reason: 'This is a demo project, latest runtime versions would be used in a production environment' }
]);

// Add suppressions for specific resources
NagSuppressions.addResourceSuppressions(stack, [
  // VPC resource suppressions
  {
    id: 'AwsSolutions-VPC7',
    reason: 'This is a demo project, VPC flow logs would be enabled in a production environment',
    appliesTo: ['Resource::VideoSearchVPC']
  },
  // DocumentDB resource suppressions
  {
    id: 'AwsSolutions-DOC2',
    reason: 'This is a demo project, non-default ports would be used in a production environment',
    appliesTo: ['Resource::VideoDataCluster']
  },
  {
    id: 'AwsSolutions-DOC3',
    reason: 'This is a demo project, Secrets Manager would be used to store credentials in a production environment',
    appliesTo: ['Resource::VideoDataCluster']
  },
  {
    id: 'AwsSolutions-DOC4',
    reason: 'This is a demo project, reasonable backup retention periods would be configured in a production environment',
    appliesTo: ['Resource::VideoDataCluster']
  },
  {
    id: 'AwsSolutions-DOC5',
    reason: 'This is a demo project, necessary log exports would be enabled in a production environment',
    appliesTo: [
      'LogExport::authenticate',
      'LogExport::createIndex',
      'LogExport::dropCollection'
    ]
  },
  // S3 resource suppressions
  {
    id: 'AwsSolutions-S1',
    reason: 'This is a demo project, server access logs would be enabled in a production environment',
    appliesTo: ['Resource::UnifiedBucket', 'Resource::CloudFrontLogsBucket']
  },
  {
    id: 'AwsSolutions-S10',
    reason: 'This is a demo project, SSL connections would be required in a production environment',
    appliesTo: ['Resource::UnifiedBucket', 'Resource::UnifiedBucket/Policy/Resource']
  },
  // API Gateway resource suppressions
  {
    id: 'AwsSolutions-APIG1',
    reason: 'This is a demo project, API access logs would be enabled in a production environment',
    appliesTo: ['Resource::VideoSearchApi/DeploymentStage.prod/Resource']
  },
  {
    id: 'AwsSolutions-APIG2',
    reason: 'This is a demo project, request validation would be enabled in a production environment',
    appliesTo: ['Resource::VideoSearchApi/Resource']
  },
  {
    id: 'AwsSolutions-APIG3',
    reason: 'This is a demo project, WAF would be associated in a production environment',
    appliesTo: ['Resource::VideoSearchApi/DeploymentStage.prod/Resource']
  },
  {
    id: 'AwsSolutions-APIG4',
    reason: 'This is a demo project, authorization would be implemented in a production environment',
    appliesTo: ['Resource::VideoSearchApi/Default/search/POST/Resource']
  },
  {
    id: 'AwsSolutions-COG4',
    reason: 'This is a demo project, Cognito user pool authorizers would be used in a production environment',
    appliesTo: ['Resource::VideoSearchApi/Default/search/POST/Resource']
  },
  // CloudFront resource suppressions
  {
    id: 'AwsSolutions-CFR1',
    reason: 'This is a demo project, geographic restrictions would be added based on business requirements in a production environment',
    appliesTo: ['Resource::FrontendDistribution']
  },
  {
    id: 'AwsSolutions-CFR2',
    reason: 'This is a demo project, integration with AWS WAF would be implemented in a production environment',
    appliesTo: ['Resource::FrontendDistribution']
  },
  {
    id: 'AwsSolutions-CFR3',
    reason: 'This is a demo project, CloudFront access logs would be enabled in a production environment',
    appliesTo: ['Resource::FrontendDistribution']
  },
  {
    id: 'AwsSolutions-CFR4',
    reason: 'This is a demo project, more secure TLS versions would be used in a production environment',
    appliesTo: ['Resource::FrontendDistribution']
  },
  // Lambda related rule suppressions
  {
    id: 'AwsSolutions-L1',
    reason: 'This is a demo project, latest runtime versions would be used in a production environment',
    appliesTo: [
      'Resource::BDAProjectProviderframeworkonEventE9BF32C3',
      'Resource::DbInitializerProviderframeworkonEvent13A4E169',
      'Resource::CustomCDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C1024MiB2048MiB98A3C176',
      'Resource::CustomCDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C512MiB1024MiB439D638D'
    ]
  },
  // IAM related rule suppressions for specific resources
  {
    id: 'AwsSolutions-IAM5',
    reason: 'This is a demo project, permissions would be more strictly limited in a production environment',
    appliesTo: [
      'Resource::VideoSearchLambdaRoleDefaultPolicy21938B05',
      'Resource::CustomCDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C1024MiB2048MiBServiceRoleDefaultPolicy0E2BB108',
      'Resource::CustomCDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C512MiB1024MiBServiceRoleDefaultPolicy5878A191'
    ]
  }
], true);

// Output the current region and stack name being used, for debugging purposes
console.log(`Deploying stack ${stackName} to region: ${region}`);
