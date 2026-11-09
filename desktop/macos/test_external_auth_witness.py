"""Extract the actual native witness plus immutable original arm; no AppKit actor."""
from pathlib import Path
import sys


def write_control(output):
    owner = Path(__file__).parent
    source = (owner / 'ExternalAuthSmoke.swift').read_text()
    start = source.index('// BEGIN EXTERNAL AUTH CALLBACK WITNESS')
    end = source.index('// END EXTERNAL AUTH CALLBACK WITNESS')
    controls = (owner / 'test_support/external_auth_witness.swift').read_text()
    engine = (owner / 'PreviewEngine.swift').read_text()
    first = engine.index('// BEGIN EXTERNAL AUTH DIAGNOSTIC READ SINK')
    last = engine.index('// END EXTERNAL AUTH DIAGNOSTIC READ SINK')
    align_start = engine.index('// BEGIN EXTERNAL AUTH DIAGNOSTIC ALIGNMENT')
    align_end = engine.index('// END EXTERNAL AUTH DIAGNOSTIC ALIGNMENT')
    method_start = engine.index('    func observeExternalAuthDiagnostics(')
    method_end = engine.index('    static func recordingEnvironment', method_start)
    read_port = ('final class CallbackDiagnosticReadPort {\n'
                 'var log = ""\nvar receipt: CallbackDiagnosticReady?\nvar authDiagnosticConsumer: (UUID, (Data) -> Void)?\n'
                 + engine[align_start:align_end] + '\n'
                 + 'func receive(_ data: Data) {\n' + engine[first:last] + '\n}\n}\n')
    ownership = ('struct CallbackDiagnosticReady { let incarnation: String }\n'
                 'final class CallbackDiagnosticSubscriptionPort {\nvar run: CallbackDiagnosticReadPort?\n'
                 + engine[method_start:method_end] + '\n}\n')
    output.write_text('import Foundation\nimport CoreFoundation\nimport Dispatch\n' + source[start:end]
                      + '\n' + read_port + ownership + controls)


if __name__ == '__main__':
    write_control(Path(sys.argv[1]))
