"""Emit closed categories only; never persist source log content in results."""
import json
from pathlib import Path
import sys


def summarize(cell, lines, operation, settlement='unknown'):
    permitted = {'network_dialog_detected', 'notification_center_frontmost', 'other_frontmost', 'unknown'}
    seen = {line.strip() for line in lines if line.strip() in permitted}
    # This is not a local-network-modal classifier. Other windows may front the
    # notification center, and this sampling can miss even a real prompt.
    observation = ('notification_center_seen' if 'notification_center_frontmost' in seen or 'network_dialog_detected' in seen
                   else 'unknown')
    return {'diagnostic_only': True, 'cell': cell, 'operation': operation,
            'owned_provider_settlement': settlement,
            'modal': 'known_dialog_detected' if 'network_dialog_detected' in seen else 'unknown',
            'frontmost_observation': observation}


def main():
    cell, observation_path, result_path, *private = sys.argv[1:]
    lines = Path(observation_path).read_text().splitlines()
    if cell == 'combined_journey':
        # No status from this reproduction is an acceptance result.
        data = summarize(cell, lines, 'finished_or_failed')
        data.update({'image_observation': 'unknown', 'phase': 'unknown', 'process_settlement': 'unknown', 'input_completion': 'unknown'})
        if len(private) == 2:
            from postprocess import postprocess, ocr
            extra = postprocess(private[0], lambda image: ocr(private[1], image))
            data.update({key: extra[key] for key in ('image_observation', 'phase', 'process_settlement', 'input_completion')})
    else:
        raw = json.loads(Path(result_path).read_text())
        data = summarize(cell, lines, raw['operation'], raw['owned_provider_settlement'])
        data.update({key: raw.get(key) if raw.get(key) in ('unknown', 'ocr_title_match') else 'unknown'
                     for key in ('before_image', 'after_image')})
        data.update(scope='diagnostic_fixture_window', fixture_process_settlement='unknown')
    print(json.dumps(data, sort_keys=True))


if __name__ == '__main__':
    main()
