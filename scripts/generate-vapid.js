import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('\nVAPID ключи. Добавь в .env:\n');
console.log(`VAPID_PUBLIC_KEY="${keys.publicKey}"`);
console.log(`VAPID_PRIVATE_KEY="${keys.privateKey}"`);
console.log(`VAPID_SUBJECT="mailto:admin@azgroup.pl"`);
console.log('');
