import boto3
import os
import json
import logging
import cfnresponse
import traceback
from datetime import datetime

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def json_serial(obj):
    """JSON serializer for objects not serializable by default json code"""
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")

def lambda_handler(event, context):
    logger.info(f"Received event: {event}")
    
    try:
        region = os.environ.get('DEPLOY_REGION', 'us-west-2')
        # Use environment variable for project name
        project_name = os.environ.get('PROJECT_NAME', 'VideoDataProject')
        
        logger.info(f"Using region: {region}, project name: {project_name}")
        
        bda_client = boto3.client('bedrock-data-automation', region_name=region)
        
        # Handle Delete event first
        if event['RequestType'] == 'Delete':
            try:
                # 获取物理资源ID，这应该是创建时保存的项目ARN
                physical_id = event.get('PhysicalResourceId')
                
                # 如果物理ID看起来像项目ARN，直接使用它
                if physical_id and physical_id.startswith('arn:aws:bedrock'):
                    project_arn = physical_id
                    logger.info(f"Using project ARN from PhysicalResourceId: {project_arn}")
                    
                    try:
                        bda_client.delete_data_automation_project(
                            projectArn=project_arn
                        )
                        logger.info(f"Successfully deleted project with ARN: {project_arn}")
                    except Exception as e:
                        logger.error(f"Error deleting project with ARN {project_arn}: {str(e)}")
                        # 返回成功以允许堆栈删除继续
                        logger.info("Returning SUCCESS despite deletion error to allow stack deletion to continue")
                else:
                    logger.info(f"No valid ARN found in PhysicalResourceId: {physical_id}")
                    logger.info("Skipping project deletion, returning SUCCESS to allow stack deletion to continue")
                
                cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
                return True
            except Exception as e:
                logger.error(f"Error in Delete handler: {str(e)}")
                # 返回成功以允许堆栈删除继续
                cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
                return True

        # Handle Create/Update events
        try:
            # Create project with name from environment variable
            logger.info(f"Creating new project {project_name}")
            response = bda_client.create_data_automation_project(
                projectName=project_name,
                projectDescription='Video data processing project for search application',
                projectStage='LIVE',
                standardOutputConfiguration={
                    'video': {
                        'extraction': {
                            'category': {
                                'state': 'ENABLED',
                                'types': ['TEXT_DETECTION', 'TRANSCRIPT', 'LOGOS'],
                            },
                            'boundingBox': {
                                'state': 'ENABLED',
                            }
                        },
                        'generativeAi': {
                            'state': 'ENABLED',
                            'types': ['VIDEO_SUMMARY', 'CHAPTER_SUMMARY', 'IAB'],
                        }
                    }
                }
            )
            logger.info(f"Project created successfully: {json.dumps(response, indent=2, default=json_serial)}")
            
            project_arn = response.get('projectArn')
            logger.info(f"Project ARN: {project_arn}")
            
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {
                'ProjectName': project_name,
                'Region': region,
                'ProjectExists': True,
                'ProjectArn': project_arn
            }, physicalResourceId=project_arn)  # 使用项目ARN作为物理资源ID
                
        except Exception as e:
            logger.error(f"Error creating project: {str(e)}")
            logger.error(traceback.format_exc())
            cfnresponse.send(event, context, cfnresponse.FAILED, {"Error": str(e)})
            
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        logger.error(traceback.format_exc())
        cfnresponse.send(event, context, cfnresponse.FAILED, {"Error": str(e)})
    
    return True
