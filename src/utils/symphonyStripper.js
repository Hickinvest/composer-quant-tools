/**
 * SymphonyStripper
 * Intercepts symphony save requests and strips asset metadata (names/exchanges) if enabled.
 */
(async function() {
    let enableStripMetadata = false;

    // Load initial settings
    async function loadSettings() {
        if (window.storageAccess) {
            try {
                const settings = await window.storageAccess.get(['enableStripMetadata']);
                if (settings && settings.hasOwnProperty('enableStripMetadata')) {
                    enableStripMetadata = settings.enableStripMetadata;
                }
            } catch (e) {
                console.error('[SymphonyStripper] Error loading settings:', e);
            }
        }
    }

    // Listen for settings updates
    window.addEventListener('message', (event) => {
        if (event.data.type === 'SETTINGS_UPDATED' && event.data.settings) {
            if (event.data.settings.hasOwnProperty('enableStripMetadata')) {
                enableStripMetadata = event.data.settings.enableStripMetadata;
            }
        } else if (event.data.type === 'INIT_READY') {
            loadSettings();
        }
    });

    function removeMetadata(json) {
        if (!json || typeof json !== 'object') return json;

        // Clone to avoid side effects
        const cleanJson = JSON.parse(JSON.stringify(json));

        function processNode(node) {
            if (!node || typeof node !== 'object') return;

            // Strip metadata ONLY from asset nodes
            if (node.step === 'asset') {
                delete node.name;
                delete node.exchange;
            }

            // Recurse through all properties to find children or nested nodes
            for (const key in node) {
                if (key === 'children' && Array.isArray(node[key])) {
                    node[key].forEach(processNode);
                } else if (typeof node[key] === 'object' && node[key] !== null) {
                    processNode(node[key]);
                }
            }
        }

        processNode(cleanJson);
        return cleanJson;
    }

    // Register with InterceptorCore
    if (window.interceptorCore) {
        window.interceptorCore.registerRequestHook(({ url, method, options, body }) => {
            const isSymphonySave = (url.includes('/api/v1/symphonies') || url.includes('/api/v2/symphonies')) && 
                                   (method === 'POST' || method === 'PUT' || method === 'PATCH');

            if (isSymphonySave && enableStripMetadata) {
                const bodyText = typeof body === 'string' ? body : options?.body;
                
                if (typeof bodyText === 'string') {
                    try {
                        const jsonBody = JSON.parse(bodyText);
                        const modifiedBody = removeMetadata(jsonBody);
                        return { newBody: JSON.stringify(modifiedBody) };
                    } catch (e) {
                        console.error('[SymphonyStripper] Error parsing body:', e);
                    }
                }
            }
            return null;
        });
    }

    loadSettings();
})();
