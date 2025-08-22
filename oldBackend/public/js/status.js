// Connect to the SSE endpoint
const eventSource = new EventSource('/events');

// Listen for messages
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  updateStatus(data);
};

const updateStatus = (data) => {
  const container = document.getElementById('status-container');
  container.innerHTML = '';

  // Display stats for each target
  for (const target in data) {
    const { successRate, successes, failures } = data[target];

    const targetDiv = document.createElement('div');
    targetDiv.className = 'target';

    const title = document.createElement('h2');
    title.textContent = `Target: ${target}`;
    targetDiv.appendChild(title);

    const rateP = document.createElement('p');
    rateP.textContent = `Success Rate: ${successRate}%`;
    targetDiv.appendChild(rateP);

    const countsP = document.createElement('p');
    countsP.textContent = `Successes: ${successes}, Failures: ${failures}`;
    targetDiv.appendChild(countsP);

    container.appendChild(targetDiv);
  }
}