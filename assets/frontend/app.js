// DOM elements
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const resultsContainer = document.getElementById('results');
const loadingElement = document.getElementById('loading');
const modeRadios = document.getElementsByName('search-mode');

// Event listeners
searchButton.addEventListener('click', performSearch);
searchInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        performSearch();
    }
});

// Get the currently selected search mode
function getSelectedMode() {
    for (const radio of modeRadios) {
        if (radio.checked) {
            return radio.value;
        }
    }
    return 'transcripts'; // Default mode
}

// Search functionality
async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    // Get the currently selected search mode
    const mode = getSelectedMode();

    // Show loading state
    loadingElement.style.display = 'block';
    resultsContainer.textContent = ''; // Fix: Use textContent instead of innerHTML

    try {
        console.log(`Performing search: query="${query}", mode=${mode}`);
        
        // Use CONFIG object for API endpoint
        const apiEndpoint = window.CONFIG ? window.CONFIG.API_ENDPOINT : '';
        if (!apiEndpoint) {
            throw new Error('API endpoint configuration is missing');
        }
        console.log('Using API endpoint:', apiEndpoint);
        
        const response = await fetch(`${apiEndpoint}/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: query,
                mode: mode, // Use the user-selected mode
                top_k: 10
            })
        });

        let data = await response.json();
        console.log('Raw API response:', data);
        
        // Handle possible nested response formats
        let results = [];
        if (data.statusCode === 200 && typeof data.body === 'string') {
            const parsedBody = JSON.parse(data.body);
            console.log('Parsed API response body:', parsedBody);
            results = parsedBody.frontend_results || [];
        } else if (data.frontend_results) {
            results = data.frontend_results;
        } else if (Array.isArray(data)) {
            // If the response is directly an array
            results = data;
        } else {
            console.warn('Unexpected API response format:', data);
            // Try to extract possible results from the response
            if (data && typeof data === 'object') {
                const possibleResults = Object.values(data).find(v => Array.isArray(v));
                if (possibleResults) {
                    results = possibleResults;
                }
            }
        }

        console.log('Processed results:', results);
        displayResults(results);
    } catch (error) {
        console.error('Search error:', error);
        // Fix XSS vulnerability: Replace innerHTML with DOM API
        resultsContainer.textContent = ''; // Clear container
        const errorParagraph = document.createElement('p');
        errorParagraph.textContent = `Error during search: ${error.message}`;
        resultsContainer.appendChild(errorParagraph);
    } finally {
        loadingElement.style.display = 'none';
    }
}

// Display results
function displayResults(results) {
    if (!Array.isArray(results) || results.length === 0) {
        // Fix XSS vulnerability: Replace innerHTML with DOM API
        resultsContainer.textContent = ''; // Clear container
        const nothingFoundParagraph = document.createElement('p');
        nothingFoundParagraph.textContent = 'No matching results found';
        resultsContainer.appendChild(nothingFoundParagraph);
        return;
    }

    console.log('Processing results:', results);
    resultsContainer.textContent = ''; // Clear container using textContent
    
    // Sort results by relevance score from high to low
    results.sort((a, b) => {
        const scoreA = a.relevance_score !== undefined ? a.relevance_score : 0;
        const scoreB = b.relevance_score !== undefined ? b.relevance_score : 0;
        return scoreB - scoreA; // Sort from high to low
    });
    
    // Add sorted results info
    console.log('Sorted results:', results.map(r => ({
        video: r.video_name || r.source,
        score: r.relevance_score,
        timestamp: r.start_timestamp_millis || r.timestamp
    })));
    
    results.forEach(result => {
        if (!result) return; // Skip invalid results
        
        const videoName = result.video_name || result.source || "Unknown Video";
        const videoUrl = getVideoUrl(videoName);
        
        // Use start_timestamp_millis as the primary timestamp, if not available try timestamp
        const timestamp = result.start_timestamp_millis || result.timestamp || 0;
        const endTimestamp = result.end_timestamp_millis || result.timestamp || timestamp;
        const text = result.text || "No text description";
        const score = result.relevance_score !== undefined ? result.relevance_score.toFixed(2) : "N/A";
        
        console.log(`Processing video item: ${videoName}, start time: ${timestamp}, end time: ${endTimestamp}, relevance: ${score}`);
        
        const card = document.createElement('div');
        card.className = 'video-card';
        
        // Fix XSS vulnerability: Replace innerHTML with DOM API
        // Create video element
        const videoElement = document.createElement('video');
        videoElement.controls = true;
        
        // Create source element
        const sourceElement = document.createElement('source');
        sourceElement.src = videoUrl;
        sourceElement.type = 'video/mp4';
        
        // Add fallback text
        const fallbackText = document.createTextNode('Your browser does not support the video tag');
        
        // Assemble video element
        videoElement.appendChild(sourceElement);
        videoElement.appendChild(fallbackText);
        
        // Create info container
        const infoDiv = document.createElement('div');
        infoDiv.className = 'video-info';
        
        // Create title
        const titleDiv = document.createElement('div');
        titleDiv.className = 'video-title';
        titleDiv.textContent = videoName;
        
        // Create timestamp
        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'video-timestamp';
        timestampDiv.textContent = `Timestamp: ${formatTimestamp(timestamp)} - ${formatTimestamp(endTimestamp)}`;
        
        // Create score
        const scoreDiv = document.createElement('div');
        scoreDiv.className = 'video-score';
        scoreDiv.textContent = `Relevance: ${score}`;
        
        // Create text paragraph
        const textP = document.createElement('p');
        textP.textContent = text;
        
        // Assemble info container
        infoDiv.appendChild(titleDiv);
        infoDiv.appendChild(timestampDiv);
        infoDiv.appendChild(scoreDiv);
        infoDiv.appendChild(textP);
        
        // Add elements to card
        card.appendChild(videoElement);
        card.appendChild(infoDiv);
        
        // Set video start time
        videoElement.addEventListener('loadedmetadata', function() {
            // Ensure timestamp is a valid number and convert to seconds
            if (timestamp !== undefined && timestamp !== null && !isNaN(timestamp)) {
                const seconds = timestamp / 1000;
                if (isFinite(seconds) && seconds >= 0) {
                    console.log(`Setting video ${videoName} start time to ${seconds} seconds`);
                    videoElement.currentTime = seconds;
                }
            }
        });
        
        resultsContainer.appendChild(card);
    });
}

// Get video URL
function getVideoUrl(videoName) {
    // If video name is a source field (like chapter_8_summary), try to extract the video name
    if (videoName.includes('chapter_') || videoName.includes('summary')) {
        // Try to extract video name from source, e.g., extract "chapter_8" from "chapter_8_summary"
        const match = videoName.match(/(chapter_\d+)/);
        if (match) {
            videoName = match[1];
        }
    }

    // If video name already includes extension, return the full URL
    if (videoName.endsWith('.mp4') || videoName.endsWith('.mov')) {
        return `${window.CONFIG.VIDEO_BASE_URL}/${videoName}`;
    }

    // If video name includes "mov", use .mov extension
    if (videoName.toLowerCase().includes('mov')) {
        return `${window.CONFIG.VIDEO_BASE_URL}/${videoName}.mov`;
    }

    // Default to .mp4 format
    return `${window.CONFIG.VIDEO_BASE_URL}/${videoName}.mp4`;
}

// Format timestamp
function formatTimestamp(milliseconds) {
    // Ensure milliseconds is a valid number
    if (milliseconds === undefined || milliseconds === null || isNaN(milliseconds)) {
        return "00:00";
    }
    
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Check configuration and display warnings
document.addEventListener('DOMContentLoaded', function() {
    console.log('Current configuration:', window.CONFIG);
    
    if (!window.CONFIG || !window.CONFIG.API_ENDPOINT || window.CONFIG.API_ENDPOINT.includes('${API_ENDPOINT}')) {
        console.warn('API_ENDPOINT is not configured, application may not work properly');
    }
    
    if (!window.CONFIG || !window.CONFIG.CLOUDFRONT_URL || window.CONFIG.CLOUDFRONT_URL.includes('${CLOUDFRONT_URL}')) {
        console.warn('CLOUDFRONT_URL is not configured, application may not work properly');
    }
});
