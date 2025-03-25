import json
import boto3
import os
from pymongo import MongoClient
import logging

# Configure logging
log_level = os.environ.get('LOG_LEVEL', 'INFO')
logging.basicConfig(level=getattr(logging, log_level), 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class VideoSearch:
    def __init__(self):
        """Initialize the VideoSearch class with MongoDB connection and Bedrock client"""
        try:
            # 硬编码的连接信息
            username = 'username123'
            password = 'Password123'
            db_endpoint = os.environ.get('DB_ENDPOINT')
            db_port = os.environ.get('DB_PORT', '27017')
            db_name = os.environ.get('DB_NAME', 'VideoData')

            if not db_endpoint:
                raise ValueError("DB_ENDPOINT environment variable is not set")

            logger.info(f"Connecting to MongoDB at {db_endpoint}:{db_port}")
            
            # 构建 MongoDB URI
            mongodb_uri = f"mongodb://{username}:{password}@{db_endpoint}:{db_port}/?replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false&ssl=false"
            logger.info(f"MongoDB URI (redacted): mongodb://{username}:****@{db_endpoint}:{db_port}/?replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false&ssl=false")
            
            # Connect to MongoDB/DocumentDB with increased timeouts and SSL disabled
            self.client = MongoClient(
                mongodb_uri, 
                socketTimeoutMS=60000, 
                connectTimeoutMS=60000,
                serverSelectionTimeoutMS=60000,
                ssl=False
            )
            self.db = self.client[db_name]
            self.collection = self.db['videodata']

            # Initialize Bedrock client for embeddings
            region = os.environ.get('DEPLOY_REGION', 'us-east-1')  # 从环境变量获取区域，默认为 us-east-1
            logger.info(f"Initializing Bedrock client in region: {region}")
            self.bedrock_client = boto3.client('bedrock-runtime', region_name=region)

            logger.info("VideoSearch initialized successfully")
        except Exception as e:
            logger.error(f"Error initializing VideoSearch: {str(e)}")
            raise

    def get_embedding(self, text):
        """Generate embedding for the input text using Amazon Bedrock Titan model"""
        try:
            response = self.bedrock_client.invoke_model(
                modelId="amazon.titan-embed-text-v2:0",
                contentType="application/json",
                accept="application/json",
                body=json.dumps({
                    "inputText": text
                })
            )
            response_body = json.loads(response.get('body').read())
            return response_body['embedding']
        except Exception as e:
            logger.error(f"Error generating embedding: {str(e)}")
            raise

    def vector_search(self, query_text, search_mode, top_k=10):
        """
        Perform vector search based on the search mode

        Args:
            query_text (str): The search query text
            search_mode (str): Either "scene" or "transcripts"
            top_k (int): Number of results to return

        Returns:
            list: Search results
        """
        try:
            # Generate embedding for the query
            query_embedding = self.get_embedding(query_text)

            # Build the filter based on search mode
            filter_condition = {}
            if search_mode == "scene":
                # Search in video_summary and chapter summaries
                filter_condition = {
                    "source": {
                        "$regex": ".*summary$"  # Match sources ending with "summary"
                    }
                }
            elif search_mode == "transcripts":
                # Search in transcript chunks
                filter_condition = {
                    "source": {
                        "$regex": ".*transcript_chunk.*"  # Match sources containing "transcript_chunk"
                    }
                }
            else:
                raise ValueError(f"Invalid search mode: {search_mode}")

            # Build the vector search pipeline
            pipeline = [
                {
                    "$search": {
                        "vectorSearch": {
                            "vector": query_embedding,
                            "path": "embedding",
                            "similarity": "cosine",
                            "k": top_k * 3,  # Fetch more results since we'll filter them
                            "efSearch": 64
                        }
                    }
                },
                # Add a $match stage to filter results based on search mode
                {
                    "$match": filter_condition
                },
                # Limit to top_k results after filtering
                {
                    "$limit": top_k
                },
                {
                    "$project": {
                        "text": 1,
                        "video_name": 1,
                        "source": 1,
                        "start_timestamp_millis": 1,
                        "end_timestamp_millis": 1
                    }
                }
            ]

            # Execute the search
            results = list(self.collection.aggregate(pipeline))
            logger.info(f"Vector search completed with {len(results)} results")
            return results
        except Exception as e:
            logger.error(f"Error in vector search: {str(e)}")
            raise

    def text_search(self, query_text, search_mode, top_k=10):
        """
        Perform text search based on the search mode

        Args:
            query_text (str): The search query text
            search_mode (str): Either "scene" or "transcripts"
            top_k (int): Number of results to return

        Returns:
            list: Search results
        """
        try:
            # Build the filter based on search mode
            filter_condition = {}
            if search_mode == "scene":
                # Search in video_summary and chapter summaries
                filter_condition = {
                    "source": {
                        "$regex": ".*summary$"  # Match sources ending with "summary"
                    }
                }
            elif search_mode == "transcripts":
                # Search in transcript chunks
                filter_condition = {
                    "source": {
                        "$regex": ".*transcript_chunk.*"  # Match sources containing "transcript_chunk"
                    }
                }
            else:
                raise ValueError(f"Invalid search mode: {search_mode}")

            # Use aggregation pipeline for text search to avoid text score issues
            pipeline = [
                {
                    "$match": {
                        "$text": {"$search": query_text},
                        **filter_condition
                    }
                },
                {
                    "$project": {
                        "text": 1,
                        "video_name": 1,
                        "source": 1,
                        "start_timestamp_millis": 1,
                        "end_timestamp_millis": 1
                    }
                },
                {
                    "$limit": top_k
                }
            ]

            # Execute the search using aggregation
            results = list(self.collection.aggregate(pipeline))

            logger.info(f"Text search completed with {len(results)} results")
            return results
        except Exception as e:
            logger.error(f"Error in text search: {str(e)}")
            raise


    def combined_search(self, query_text, search_mode, top_k=10):
        """
        Perform both vector and text search and combine the results

        Args:
            query_text (str): The search query text
            search_mode (str): Either "scene" or "transcripts"
            top_k (int): Number of results to return for each search method

        Returns:
            dict: Combined search results
        """
        try:
            # Perform both search types
            vector_results = self.vector_search(query_text, search_mode, top_k)
            text_results = self.text_search(query_text, search_mode, top_k)

            # Process results to make them JSON serializable (convert ObjectId to string)
            processed_vector_results = []
            for result in vector_results:
                result['_id'] = str(result['_id'])
                result['search_type'] = 'vector'  # Add search type for vector results
                processed_vector_results.append(result)

            processed_text_results = []
            for result in text_results:
                result['_id'] = str(result['_id'])
                result['search_type'] = 'text'  # Add search type for text results
                processed_text_results.append(result)

            # Combine all results into one list
            all_results = processed_vector_results + processed_text_results

            # Remove duplicates based on '_id' and prefer text search results
            unique_results = []
            seen_ids = set()
            for result in reversed(all_results):  # Reverse the list to process text results first
                result_id = result['_id']
                if result_id not in seen_ids:
                    seen_ids.add(result_id)
                    unique_results.append(result)
            unique_results.reverse()  # Reverse the list back to original order

            # Return unique results directly
            return {"results": unique_results}
        except Exception as e:
            logger.error(f"Error in combined search: {str(e)}")
            raise

    def rerank_results(self, query, results):
        # Prepare documents list for reranking
        documents = []
        metadata_map = {}  # Store metadata separately

        for result in results:
            # Generate a unique key for this result
            result_key = str(result["_id"])
            # Store the text as a string
            documents.append(result["text"])
            # Store metadata separately
            metadata_map[result_key] = {
                "_id": result_key,
                "video_name": result["video_name"],
                "source": result["source"],
                "start_timestamp_millis": result["start_timestamp_millis"],
                "end_timestamp_millis": result["end_timestamp_millis"],
                "search_type": result["search_type"]  # Preserve search type in metadata
            }

        # Call Cohere rerank
        response = self.bedrock_client.invoke_model(
            modelId="cohere.rerank-v3-5:0",
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "api_version": 2,
                "query": query,
                "documents": documents,
                "top_n": len(documents)
            })
        )

        # Process rerank results
        response_body = json.loads(response.get('body').read())
        reranked_results = []

        for idx, item in enumerate(response_body['results']):
            # Get the original text and metadata using the index
            original_index = item['index']
            text = documents[original_index]
            original_result = results[original_index]
            metadata = metadata_map[str(original_result['_id'])]

            # Combine everything into a result
            result = {
                **metadata,
                'text': text,
                'relevance_score': item['relevance_score'],
                'search_type': metadata['search_type']  # Include search type in final result
            }
            reranked_results.append(result)

        return reranked_results

def lambda_handler(event, context):
    """
    AWS Lambda handler function

    Expected event format:
    {
        "query": "search query text",
        "mode": "scene" or "transcripts",
        "top_k": 10 (optional)
    }
    """
    try:
        # Parse the event
        body = event
        if 'body' in event:
            if isinstance(event['body'], str):
                body = json.loads(event['body'])
            else:
                body = event['body']

        query = body.get('query')
        mode = body.get('mode')
        top_k = body.get('top_k', 10)

        if not query:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'Missing query parameter'})
            }

        if not mode or mode not in ['scene', 'transcripts']:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'Invalid or missing mode parameter. Must be "scene" or "transcripts"'})
            }

        # Initialize the search class
        search = VideoSearch()

        # Perform the combined search
        combined_results = search.combined_search(query, mode, top_k)

        # Rerank the combined results
        reranked_results = search.rerank_results(query, combined_results["results"])

        # Sort results by relevance score
        sorted_results = sorted(reranked_results, key=lambda x: x['relevance_score'], reverse=True)

        # Deduplicate results based on _id while maintaining the highest relevance score
        seen_ids = set()
        unique_results = []
        for result in sorted_results:
            if result['_id'] not in seen_ids:
                seen_ids.add(result['_id'])
                unique_results.append(result)

        # Filter out results with similarity below 0.05
        final_results = [result for result in unique_results if result['relevance_score'] >= 0.05]

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            'body': json.dumps({
                "frontend_results": final_results
            })
        }
    except Exception as e:
        import traceback
        error_traceback = traceback.format_exc()
        logger.error(f"Error in lambda_handler: {str(e)}")
        logger.error(f"Traceback: {error_traceback}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e),
                'traceback': error_traceback
            })
        }
