"""The comparison assistant's model call, made here because this service already holds ANTHROPIC_API_KEY.

Atlas (apps/atlas/app/api/advisor) checks the signed-in user, validates the conversation and owns the system prompt;
this module only forwards one bounded request with a fixed model, so the key never leaves the service."""
import json
import logging
import os
import urllib.error
import urllib.request

LOGGER = logging.getLogger('farq.targeting.advisor')

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
        # what the API said, never the key or the conversation: enough to tell a bad key, no credit or a bad field apart
        LOGGER.warning('advisor upstream http=%s %s', error.code, upstream_error(error))
        return (429, {'error': 'BUSY'}) if error.code in (429, 529) else (502, {'error': 'UPSTREAM'})
    except (OSError, ValueError) as error:
        LOGGER.warning('advisor upstream unreachable: %s', type(error).__name__)
        return 502, {'error': 'UPSTREAM'}
    if answer.get('stop_reason') == 'refusal':
        return 422, {'error': 'REFUSED'}
    text = '\n'.join(block.get('text', '') for block in answer.get('content') or [] if block.get('type') == 'text').strip()
    return (200, {'reply': text}) if text else (502, {'error': 'UPSTREAM'})


def upstream_error(error):
    """The API's error type, message and request id from an HTTP error, cut short; «unreadable» when it sent none."""
    try:
        body = json.loads(error.read() or b'{}')
    except Exception:  # an error with no body (or one that cannot be read) still gets its status logged
        return 'unreadable'
    # any JSON may come back (a list, a string, an «error» that is not an object): only an object is read
    if not isinstance(body, dict):
        return 'unreadable'
    detail = body.get('error') if isinstance(body.get('error'), dict) else {}
    headers = getattr(error, 'headers', None) or {}
    request_id = body.get('request_id') or headers.get('request-id', '')
    return f"type={detail.get('type', '?')} message={str(detail.get('message', ''))[:200]} request_id={request_id}"
