// Task queue management

let queue = [];
let isProcessing = false;

// Process the next task in the queue
function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;
  const task = queue.shift();
  task().then(() => {
    isProcessing = false;
    processQueue();
  }).catch(error => {
    console.error("Error processing task:", error);
    isProcessing = false;
    processQueue();
  });
}

// Add a task to the queue
function enqueueTask(task) {
  queue.push(task);
  processQueue();
}

export { enqueueTask }; 