import { connect } from 'cloudflare:sockets';

let userID = '43e8276e-104b-45d7-9dac-b8a1fc7c2a24';
let proxyIP = 'your-vless-server-domain.com'; // Use domain if possible
let dohURL = 'https://dns.google/dns-query'; // Optimize DNS resolution

export default {
    async fetch(request, env, ctx) {
        try {
            userID = env.UUID || userID;
            proxyIP = env.proxyIP || proxyIP;
            dohURL = env.DNS_RESOLVER_URL || dohURL;

            if (request.headers.get('Upgrade') !== 'websocket') {
                return handleHTTPRequest(request);
            } else {
                return await handleWebSocketRequest(request);
            }
        } catch (err) {
            return new Response(`Error: ${err.message}`, { status: 500 });
        }
    },
};

async function handleHTTPRequest(request) {
    const url = new URL(request.url);
    switch (url.pathname) {
        case `/cf`:
            return new Response(JSON.stringify(request.cf, null, 4), {
                status: 200,
                headers: { "Content-Type": "application/json;charset=utf-8" },
            });
        case `/${userID}`:
            return generateVlessConfig(request.headers.get('Host'));
        default:
            return new Response('Not found', { status: 404 });
    }
}

async function handleWebSocketRequest(request) {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    server.accept();

    const readableStream = makeReadableWebSocketStream(server);

    readableStream.pipeTo(new WritableStream({
        async write(chunk) {
            try {
                const tcpSocket = await connectToRemoteServer(chunk);
                await tcpSocket.writable.getWriter().write(chunk);
            } catch (err) {
                console.error('Error writing to remote server:', err);
            }
        },
        close() {
            console.log('WebSocket connection closed');
        },
        abort(reason) {
            console.error('WebSocket connection aborted:', reason);
        }
    }));

    return new Response(null, { status: 101, webSocket: client });
}

async function connectToRemoteServer(data) {
    try {
        return connect({
            hostname: proxyIP,
            port: 443,
            enableTfo: true,
            congestionControl: 'bbr',
            tcpNoDelay: true,
            tls: { enableFalseStart: true, serverName: proxyIP }, // Set the serverName for SNI
        });
    } catch (err) {
        console.error('Error connecting to remote server:', err);
        throw err;
    }
}

function makeReadableWebSocketStream(server) {
    return new ReadableStream({
        start(controller) {
            server.addEventListener('message', event => controller.enqueue(event.data));
            server.addEventListener('close', () => controller.close());
            server.addEventListener('error', err => controller.error(err));
        },
    });
}

function generateVlessConfig(host) {
    const vlessConfig = `vless://${userID}@${host}:443?encryption=none&security=tls&sni=${host}&type=ws&host=${host}&path=%2Fws#Worker`;
    return new Response(vlessConfig, { status: 200, headers: { "Content-Type": "text/html" } });
}
