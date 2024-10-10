import { connect } from 'cloudflare:sockets';

let userID = '43e8276e-104b-45d7-9dac-b8a1fc7c2a24'; // Default UUID for client identification
const proxyIPs = ['212.192.9.26']; // List of proxy IPs
let proxyIP = proxyIPs[0]; // Use the first proxy IP by default

export default {
    async fetch(request, env, _ctx) {
        userID = env.UUID || userID; // Use the UUID from the environment if provided
        proxyIP = env.proxyIP || proxyIP; // Use proxyIP from the environment if available
        const upgradeHeader = request.headers.get("Upgrade");

        if (upgradeHeader !== "websocket") return new Response(null, { status: 404 });

        // Create WebSocket pairs for client and server
        const [client, server] = Object.values(new WebSocketPair());

        // Accept the WebSocket connection on the server side
        server.accept();

        // Handle WebSocket messages from the client, only listen to the first message
        server.addEventListener('message', async ({ data }) => {
            try {
                // Parse the incoming data from the client as JSON
                const { hostname, port, uuid } = JSON.parse(data);

                // Check if the UUID matches for client identification
                if (userID !== uuid) throw 'Unauthorized access: Invalid UUID';

                // Establish a TCP connection to the target host and port, using proxy IP if specified
                const socket = connect({ hostname: proxyIP || hostname, port });

                // Set up a ReadableStream to forward data from WebSocket to TCP connection
                new ReadableStream({
                    start(controller) {
                        server.onmessage = ({ data }) => controller.enqueue(data); // Forward WebSocket data to TCP
                        server.onerror = e => controller.error(e); // Handle WebSocket errors
                        server.onclose = () => controller.close(); // Handle WebSocket closure
                    },
                    cancel() { server.close(); } // Close WebSocket if stream is canceled
                }).pipeTo(socket.writable);

                // Set up a WritableStream to forward data from TCP connection back to WebSocket
                socket.readable.pipeTo(new WritableStream({
                    start(controller) { server.onerror = e => controller.error(e); }, // Handle TCP errors
                    write(chunk) { server.send(chunk); } // Send TCP data to WebSocket
                }));

            } catch (error) {
                console.error('Connection error:', error);
                server.close(); // Close WebSocket in case of an error
            }
        }, { once: true });

        // Return the WebSocket upgrade response
        return new Response(null, { status: 101, webSocket: client });
    }
};
