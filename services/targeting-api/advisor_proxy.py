"""The comparison assistant's model call, made here because this service already holds ANTHROPIC_API_KEY.

Atlas (apps/atlas/app/api/advisor) checks the signed-in user, validates the conversation and owns the system prompt;
this module only forwards one bounded request with a fixed model, so the key never leaves the service."""
import json
import os
import urllib.error
import urllib.request

MODEL = 'claude-opus-5-5'
MAX_SYSTEM = 6000
MAX_MESSAGES = 21
MAX_TEXT = 10000


def read(body):
    """(system, messages) from a request body, or ValueError when it is out of bounds."""
    system, messages = body.get('system'), body.get('messages')
    if not isinstance(system, str) or not 1 <= len(system) <= MAX_SYSTEM:
        raise ValueError('system')
    if not isinstance(messages, list) or not 1 <= len(messages) <= MAX_MESSAGES:
        raise ValueError('messages')
    for index, message in enumerate(messages):
        if (not isinstance(message, dict) or message.get('role') != ('user' if index % 2 == 0 else 'assistant')
                or not isinstance(message.get('content'), str) or not 1 <= len(message['content']) <= MAX_TEXT):
            raise ValueError('messages')
    if messages[-1]['role'] != 'user':
        raise ValueError('messages')
    return system, [{'role': message['role'], 'content': message['content']} for message in messages]


def reply(system, messages, environ=os.environ, opener=urllib.request.urlopen):
    """(status, body): {'reply'} on success, {'error'} with UNCONFIGURED, REFUSED, BUSY or UPSTREAM otherwise."""
    key = environ.get('ANTHROPIC_API_KEY')
    if not key:
        return 503, {'error': 'UNCONFIGURED'}
    payload = {'model': MODEL, 'max_tokens': 16000, 'system': system, 'messages': messages,
               'output_config': {'effort': 'low'}, 'fallbacks': 'default'}
    request = urllib.request.Request('https://api.anthropic.com/v1/messages', data=json.dumps(payload).encode(), headers={
        'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01',
        'content-type': 'application/json'})
    try:
        with opener(request, timeout=55) as response:
            answer = json.loads(response.read())
    except urllib.error.HTTPError as error:
        return (429, {'error': 'BUSY'}) if error.code in (429, 529) else (502, {'error': 'UPSTREAM'})
    except (OSError, ValueError):
        return 502, {'error': 'UPSTREAM'}
    if answer.get('stop_reason') == 'refusal':
        return 422, {'error': 'REFUSED'}
    text = '\n'.join(block.get('text', '') for block in answer.get('content') or [] if block.get('type') == 'text').strip()
    return (200, {'reply': text}) if text else (502, {'error': 'UPSTREAM'})
