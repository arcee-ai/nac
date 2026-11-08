"""Extract the actual native witness plus immutable original arm; no AppKit actor."""
from pathlib import Path
import sys


def write_control(output):
    owner = Path(__file__).parent
    source = (owner / 'ExternalAuthSmoke.swift').read_text()
    start = source.index('// BEGIN EXTERNAL AUTH CALLBACK WITNESS')
    end = source.index('// END EXTERNAL AUTH CALLBACK WITNESS')
    controls = (owner / 'test_support/external_auth_witness.swift').read_text()
    output.write_text('import Foundation\nimport CoreFoundation\n' + source[start:end] + '\n' + controls)


if __name__ == '__main__':
    write_control(Path(sys.argv[1]))
