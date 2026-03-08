/**
 * RetryHelper — Exponential backoff retry with jitter
 *
 * Used for transient failures in API calls, network requests, etc.
 *
 * @example
 *   const result = await retry(() => callAPI(), { maxRetries: 3 });
 *   const result = await retry(() => fetchData(), { retryOn: [429, 503] });
 */

/**
 * Execute a function with automatic retry on failure
 * @param {function} fn - Async function to execute
 * @param {object} options
 * @param {number} options.maxRetries - Maximum retry attempts (default: 3)
 * @param {number} options.baseDelay - Base delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay cap in ms (default: 30000)
 * @param {number} options.factor - Backoff multiplier (default: 2)
 * @param {boolean} options.jitter - Add randomness to delay (default: true)
 * @param {number[]} options.retryOn - HTTP status codes to retry on (default: [429, 500, 502, 503, 504])
 * @param {function} options.onRetry - Callback before each retry: (error, attempt, delay)
 * @param {string} options.label - Label for logging
 * @returns {*} Result from fn
 */
async function retry(fn, options = {}) {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        maxDelay = 30000,
        factor = 2,
        jitter = true,
        retryOn = [429, 500, 502, 503, 504],
        onRetry = null,
        label = 'operation',
    } = options;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Check if we should retry
            if (attempt >= maxRetries) break;

            // Check if error is retryable
            const statusCode = error.status || error.statusCode || error.code;
            if (statusCode && !retryOn.includes(statusCode)) {
                // Non-retryable error (e.g., 401, 403, 404)
                break;
            }

            // Calculate delay with exponential backoff
            let delay = Math.min(baseDelay * Math.pow(factor, attempt), maxDelay);

            // Add jitter (0.5x to 1.5x)
            if (jitter) {
                delay = delay * (0.5 + Math.random());
            }

            // Handle Retry-After header (HTTP 429)
            if (error.headers && error.headers['retry-after']) {
                const retryAfter = parseInt(error.headers['retry-after'], 10);
                if (!isNaN(retryAfter)) {
                    delay = retryAfter * 1000;
                }
            }

            delay = Math.round(delay);

            console.log(`🔄 [Retry:${label}] Attempt ${attempt + 1}/${maxRetries} failed. Retrying in ${delay}ms...`);

            if (onRetry) {
                try {
                    onRetry(error, attempt + 1, delay);
                } catch (e) {
                    // Don't let callback errors break retry logic
                }
            }

            await sleep(delay);
        }
    }

    throw lastError;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a retry-wrapped version of a function
 * @param {function} fn - Function to wrap
 * @param {object} options - Retry options
 * @returns {function} Wrapped function with automatic retry
 */
function withRetry(fn, options = {}) {
    return (...args) => retry(() => fn(...args), options);
}

module.exports = { retry, withRetry, sleep };
