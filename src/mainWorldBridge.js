// Bridge script that runs in the MAIN world to access React internals
window.addEventListener('message', async function(event) {
    // Only handle messages requesting React props
    if (event.data.type === 'GET_REACT_PROPS') {
        const element = event.data.element;
        const propSelector = event.data.propSelector; // e.g. "children.props"
        
        // Find the DOM element
        const domElement = document.querySelector(element);
        
        if (!domElement) {
            window.postMessage({
                type: 'REACT_PROPS_RESULT',
                id: event.data.id,
                error: 'Element not found'
            }, '*');
            return;
        }

        try {
            // Extract React props using the special key pattern
            const reactPropsKey = Object.keys(domElement).find(key => key.startsWith('__reactProps'));
            if (!reactPropsKey) {
                window.postMessage({
                    type: 'REACT_PROPS_RESULT',
                    id: event.data.id,
                    error: 'No React props found'
                }, '*');
                return;
            }

            // Get the initial props object
            let props = domElement[reactPropsKey];
            
            // Navigate through the prop selector if provided
            if (propSelector) {
                const parts = propSelector.split('.');
                for (const part of parts) {
                    props = props?.[part];
                }
            }
            
            window.postMessage({
                type: 'REACT_PROPS_RESULT',
                id: event.data.id,
                data: props
            }, '*');
        } catch (error) {
            window.postMessage({
                type: 'REACT_PROPS_RESULT',
                id: event.data.id,
                error: error.message
            }, '*');
        }
    }
});
