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
                logger.info(f"Deleting project {project_name}")
                bda_client.delete_data_automation_project(
                    projectName=project_name
                )
                logger.info(f"Successfully deleted project {project_name}")
                cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
                return True
            except bda_client.exceptions.ResourceNotFoundException:
                logger.info(f"Project {project_name} not found, skipping deletion")
                cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
                return True
            except Exception as e:
                logger.error(f"Error deleting project: {str(e)}")
                cfnresponse.send(event, context, cfnresponse.FAILED, {"Error": str(e)})
                return False

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
            }, physicalResourceId=project_name)
                
        except Exception as e:
            logger.error(f"Error creating project: {str(e)}")
            logger.error(traceback.format_exc())
            cfnresponse.send(event, context, cfnresponse.FAILED, {"Error": str(e)})
            
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        logger.error(traceback.format_exc())
        cfnresponse.send(event, context, cfnresponse.FAILED, {"Error": str(e)})
    
    return True
