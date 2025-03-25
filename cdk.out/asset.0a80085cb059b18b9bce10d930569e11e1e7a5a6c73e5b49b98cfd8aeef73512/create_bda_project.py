import boto3
import os
import json
import logging
import urllib.request
import urllib.error

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# CloudFormation 响应函数
def send_response(event, context, response_status, response_data, physical_resource_id=None):
    response_body = {
        'Status': response_status,
        'Reason': f'See the details in CloudWatch Log Stream: {context.log_stream_name}',
        'PhysicalResourceId': physical_resource_id or context.log_stream_name,
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'Data': response_data
    }
    
    response_body_json = json.dumps(response_body)
    logger.info(f"Response body: {response_body_json}")
    
    headers = {
        'Content-Type': '',
        'Content-Length': str(len(response_body_json))
    }
    
    try:
        req = urllib.request.Request(
            url=event['ResponseURL'],
            data=response_body_json.encode('utf-8'),
            headers=headers,
            method='PUT'
        )
        with urllib.request.urlopen(req) as response:
            logger.info(f"Status code: {response.status}")
            logger.info(f"Status message: {response.reason}")
        return True
    except Exception as e:
        logger.error(f"Error sending response: {str(e)}")
        return False

def lambda_handler(event, context):
    logger.info(f"Received event: {json.dumps(event)}")
    
    # 获取环境变量
    project_name = os.environ.get('PROJECT_NAME')
    region = os.environ.get('DEPLOY_REGION')
    
    # 初始化 Bedrock Data Automation 客户端
    bda_client = boto3.client('bedrock-data-automation', region_name=region)
    
    try:
        if event['RequestType'] == 'Create' or event['RequestType'] == 'Update':
            # 检查项目是否已存在
            try:
                response = bda_client.get_data_project(
                    dataProjectName=project_name
                )
                logger.info(f"Project {project_name} already exists")
            except bda_client.exceptions.ResourceNotFoundException:
                # 创建项目
                logger.info(f"Creating project {project_name}")
                response = bda_client.create_data_project(
                    dataProjectName=project_name,
                    description=f"Video data project created by CDK for {region}",
                    tags={
                        'CreatedBy': 'CDK',
                        'Environment': 'POC'
                    }
                )
                logger.info(f"Project created: {response}")
            
            return send_response(event, context, 'SUCCESS', {
                'ProjectName': project_name,
                'Region': region
            })
        elif event['RequestType'] == 'Delete':
            # 在删除堆栈时，您可以选择是否删除项目
            # 这里我们选择不删除，因为可能有重要数据
            logger.info(f"Not deleting project {project_name} to preserve data")
            return send_response(event, context, 'SUCCESS', {})
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return send_response(event, context, 'FAILED', {
            'Error': str(e)
        })
