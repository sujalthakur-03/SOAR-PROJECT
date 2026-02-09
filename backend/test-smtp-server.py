#!/usr/bin/env python3
"""
Local SMTP catch-all server for CyberSentinel SOAR testing.
Accepts all emails on port 2525 and logs them to stdout + file.
No authentication required.
"""
import smtpd
import asyncore
import json
import datetime
import os

LOG_FILE = os.path.join(os.path.dirname(__file__), 'captured-emails.log')

class CatchAllSMTP(smtpd.SMTPServer):
    def process_message(self, peer, mailfrom, rcpttos, data, **kwargs):
        timestamp = datetime.datetime.now().isoformat()
        entry = {
            'timestamp': timestamp,
            'peer': f'{peer[0]}:{peer[1]}',
            'from': mailfrom,
            'to': rcpttos,
            'size': len(data) if isinstance(data, bytes) else len(data.encode()),
        }

        body = data.decode('utf-8', errors='replace') if isinstance(data, bytes) else data
        entry['body_preview'] = body[:500]

        print(f'\n{"="*60}')
        print(f'[{timestamp}] EMAIL CAPTURED')
        print(f'  From: {mailfrom}')
        print(f'  To:   {", ".join(rcpttos)}')
        print(f'  Size: {entry["size"]} bytes')
        print(f'{"="*60}')
        print(body[:1000])
        print(f'{"="*60}\n')

        with open(LOG_FILE, 'a') as f:
            f.write(json.dumps(entry) + '\n')

        return None  # Accept the message

if __name__ == '__main__':
    server = CatchAllSMTP(('0.0.0.0', 2525), None)
    print(f'[CyberSentinel Test SMTP] Listening on port 2525')
    print(f'[CyberSentinel Test SMTP] Emails logged to: {LOG_FILE}')
    asyncore.loop()
