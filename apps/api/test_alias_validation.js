import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

socket.on('connect', () => {
    console.log('Connected');

    console.log('--- Test 1: Valid ETH alias ---');
    socket.emit('labelInsert', {
        body: {
            addr: '0x1234567890123456789012345678901234567891',
            chains: ['eip155:1'],
            label: 'Test Label 1',
            aliases: [{ name: 'validname.eth', chain: 'eip155:1' }]
        }
    });

    setTimeout(() => {
        console.log('--- Test 2: Invalid SOL alias on ETH ---');
        socket.emit('labelInsert', {
            body: {
                addr: '0x0987654321098765432109876543210987654321',
                chains: ['eip155:1'],
                label: 'Test Label 2',
                aliases: [{ name: 'invalidname.sol', chain: 'eip155:1' }]
            }
        });
    }, 1000);

    setTimeout(() => {
        socket.emit('labelDelete', {
            body: { addr: '0x1234567890123456789012345678901234567891' }
        });
        process.exit();
    }, 2000);
});

socket.on('success', (data) => console.log('SUCCESS:', data));
socket.on('failure', (data) => console.error('FAILURE:', data));
