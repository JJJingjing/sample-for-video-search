import boto3
import os
import json
import logging
import cfnresponse

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    logger.info(f"Received event: {event}")
    
    try:
        # 获取区域，默认为 us-west-2
        region = os.environ.get('DEPLOY_REGION', 'us-west-2')
        project_name = os.environ.get('PROJECT_NAME', 'VideoDataProject')
        
        logger.info(f"Using region: {region}, project name: {project_name}")
        
        # 创建 Bedrock Data Automation 客户端
        bda_client = boto3.client('bedrock-data-automation', region_name=region)
        
        # 检查项目是否已存在
        try:
            # 使用 list_data_automation_projects 而不是 get_data_project
            response = bda_client.list_data_automation_projects()
            projects = response.get('projects', [])
            
            project_exists = False
            for project in projects:
                if project.get('projectName') == project_name:
                    project_exists = True
                    logger.info(f"Project {project_name} already exists")
                    break
                    
            if not project_exists:
                # 创建项目
                logger.info(f"Creating project {project_name}")
                response = bda_client.create_data_automation_project(
                    dataProjectName=project_name,
                    description=f"Video data project for video search application in {region}"
                )
                logger.info(f"Project created: {response}")
            
            # 返回成功
            if event['RequestType'] == 'Create' or event['RequestType'] == 'Update':
                cfnresponse.send(event, context, cfnresponse.SUCCESS, {
                    'ProjectName': project_name,
                    'Region': region
                })
            elif event['RequestType'] == 'Delete':
                # 删除项目的逻辑（如果需要）
                # 注意：您可能想保留项目及其数据，所以这里不执行删除操作
                logger.info(f"Not deleting project {project_name} to preserve data")
                cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
                
        except Exception as e:
            logger.error(f"Error checking/creating project: {str(e)}")
            cfnresponse.send(event, context, cfnresponse.FAILED, {"Error": str(e)})
            
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {"Error": str(e)})
    
    return True
