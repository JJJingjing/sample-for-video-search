import boto3
import json
import os
import re

ENDPOINT_RUNTIME = os.environ.get('BDA_RUNTIME_ENDPOINT', None)
DEPLOY_REGION = os.environ.get('DEPLOY_REGION', 'us-west-2')  # Get region from environment variable

# Create a Bedrock client
bda_client_runtime = boto3.client("bedrock-data-automation-runtime",
                                region_name=DEPLOY_REGION,  # Use region from environment variable
                                **({'endpoint_url': ENDPOINT_RUNTIME} if ENDPOINT_RUNTIME is not None else {}),
                                verify=True)

# Create bedrock-data-automation client
bda_client = boto3.client('bedrock-data-automation', region_name=DEPLOY_REGION)

# Function to get project ARN using standard boto3 API call
def get_project_arn(project_name):
    try:
        # List projects using standard API call
        response = bda_client.list_data_automation_projects()
        projects = response.get('projects', [])
        
        # Print project list for debugging
        print(f"Available projects: {projects}")
        
        # Filter matching projects
        projects_filtered = [item for item in projects if project_name == item.get('projectName')]
        if len(projects_filtered) == 0:
            # If project not found, try to create one
            print(f"Project {project_name} not found, attempting to create it")
            try:
                create_response = bda_client.create_data_automation_project(
                    projectName=project_name,
                    projectDescription=f"Video data project created automatically for {DEPLOY_REGION}"
                )
                print(f"Project created: {create_response}")
                # Retrieve project list again
                response = bda_client.list_data_automation_projects()
                projects = response.get('projects', [])
                projects_filtered = [item for item in projects if project_name == item.get('projectName')]
                if len(projects_filtered) == 0:
                    raise Exception(f"Failed to create project {project_name}")
            except Exception as create_error:
                print(f"Error creating project: {str(create_error)}")
                raise Exception(f"Project {project_name} not found and could not be created: {str(create_error)}")
        
        project_arn = projects_filtered[0].get('projectArn')
        print(f"Found project ARN: {project_arn}")
        return project_arn
    except Exception as e:
        print(f"Error getting project ARN: {str(e)}")
        raise

# invokes bda by async approach with a given input file
def invoke_insight_generation_async(
        input_s3_uri,
        output_s3_uri,
        data_project_arn, blueprints = None):

    # Extract account ID from project ARN
    account_id = data_project_arn.split(':')[4]
    
    # Construct default Profile ARN using fixed us-west-2 region
    profile_arn = f"arn:aws:bedrock:us-west-2:{account_id}:data-automation-profile/us.data-automation-v1"

    payload = {
        "inputConfiguration": {
            "s3Uri": input_s3_uri
        },
        "outputConfiguration": {
            "s3Uri": output_s3_uri
        },
        "dataAutomationConfiguration": {
            "dataAutomationProjectArn": data_project_arn,
            "stage": "LIVE"
        },
        "dataAutomationProfileArn": profile_arn,
        "notificationConfiguration": {
            "eventBridgeConfiguration": {"eventBridgeEnabled": True},
        }
    }

    try:
        response = bda_client_runtime.invoke_data_automation_async(**payload)
        print(f"Successfully invoked data automation: {response}")
        return response
    except Exception as e:
        print(f"Error invoking data automation: {str(e)}")
        raise
