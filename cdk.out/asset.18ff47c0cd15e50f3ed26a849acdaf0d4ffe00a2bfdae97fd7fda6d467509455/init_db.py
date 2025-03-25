import json
import boto3
import os
import time
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
import logging
import socket

# Configure logging
log_level = os.environ.get('LOG_LEVEL', 'INFO')
logging.basicConfig(level=getattr(logging, log_level), 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def lambda_handler(event, context):
    max_retries = 5
    retry_delay = 30  # 秒
    
    for attempt in range(max_retries):
        try:
            # 硬编码的连接信息
            username = 'username123'
            password = 'Password123'
            db_endpoint = os.environ.get('DB_ENDPOINT')
            db_port = os.environ.get('DB_PORT', '27017')
            db_name = os.environ.get('DB_NAME', 'VideoData')
            collection_name = os.environ.get('COLLECTION_NAME', 'videodata')

            if not db_endpoint:
                raise ValueError("DB_ENDPOINT environment variable is not set")

            logger.info(f"Attempt {attempt + 1}: Connecting to DocumentDB at {db_endpoint}:{db_port}")
            
            # 尝试解析主机名
            try:
                if '${' not in db_endpoint:  # 如果不是占位符
                    ip = socket.gethostbyname(db_endpoint)
                    logger.info(f"DNS resolution successful for {db_endpoint}: {ip}")
            except Exception as dns_error:
                logger.warning(f"DNS resolution failed or skipped: {str(dns_error)}")
            
            # 构建 MongoDB URI
            mongodb_uri = f"mongodb://{username}:{password}@{db_endpoint}:{db_port}/?replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false&ssl=false"
            logger.info(f"MongoDB URI (redacted): mongodb://{username}:****@{db_endpoint}:{db_port}/?replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false&ssl=false")
            
            # Connect to MongoDB/DocumentDB with increased timeouts
            client = MongoClient(
                mongodb_uri, 
                socketTimeoutMS=300000,  # 5分钟
                connectTimeoutMS=300000,  # 5分钟
                serverSelectionTimeoutMS=300000,  # 5分钟
                ssl=False  # 禁用SSL/TLS
            )
            
            # Test connection
            logger.info(f"Attempt {attempt + 1}: Testing connection to DocumentDB...")
            client.admin.command('ismaster')
            logger.info("Connection to DocumentDB successful")
            
            db = client[db_name]
            collection = db[collection_name]
            
            # 获取现有索引
            existing_indexes = collection.index_information()
            logger.info(f"Existing indexes: {existing_indexes}")
            
            # 删除任何可能冲突的索引
            for index_name in list(existing_indexes.keys()):
                if index_name != '_id_':  # 保留主键索引
                    logger.info(f"Dropping index: {index_name}")
                    try:
                        collection.drop_index(index_name)
                    except Exception as e:
                        logger.warning(f"Error dropping index {index_name}: {str(e)}")

            # Create text index for text search with specific name
            logger.info("Creating text index...")
            collection.create_index([("text", "text")], 
                                   name="text_index")
            
            # Create timestamp index
            logger.info("Creating timestamp index...")
            collection.create_index([("start_timestamp_millis", 1), ("end_timestamp_millis", 1)],
                                   name="start_timestamp_millis_1_end_timestamp_millis_1")
            
            # Create vector index for embeddings (for DocumentDB 5.0.0)
            logger.info("Creating vector index for embeddings...")
            try:
                collection.create_index([("embedding", "vector")],
                                       name="vector_index",
                                       vectorOptions={
                                           "type": "ivfflat",
                                           "dimensions": 1024,
                                           "similarity": "cosine",
                                           "lists": 1000
                                       })
                logger.info("Vector index created successfully")
            except Exception as e:
                logger.error(f"Error creating vector index: {str(e)}")
                logger.warning("Failed to create vector index. Make sure DocumentDB version supports vector indexes (5.0.0+)")

            logger.info("Database initialization completed successfully")
            
            return {
                'statusCode': 200,
                'body': json.dumps('Database initialized successfully')
            }
        except ConnectionFailure as e:
            logger.error(f"Failed to connect to MongoDB: {str(e)}")
            # 检查网络连接
            try:
                if db_endpoint and '${' not in db_endpoint:  # 如果不是占位符
                    socket.gethostbyname(db_endpoint)
                    logger.info(f"DNS resolution successful for {db_endpoint}")
            except Exception as dns_error:
                logger.error(f"DNS resolution failed: {str(dns_error)}")
            
            if attempt < max_retries - 1:
                logger.warning(f"Connection attempt {attempt + 1} failed: {str(e)}. Retrying in {retry_delay} seconds...")
                time.sleep(retry_delay)
            else:
                logger.error(f"All connection attempts failed: {str(e)}")
                raise
        except ServerSelectionTimeoutError as e:
            logger.error(f"Server selection timeout: {str(e)}")
            if attempt < max_retries - 1:
                logger.warning(f"Connection attempt {attempt + 1} failed: {str(e)}. Retrying in {retry_delay} seconds...")
                time.sleep(retry_delay)
            else:
                logger.error(f"All connection attempts failed: {str(e)}")
                raise
        except Exception as e:
            logger.error(f"Error initializing database: {str(e)}")
            raise
