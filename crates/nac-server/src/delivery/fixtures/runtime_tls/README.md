# Runtime TLS test fixtures

These certificates and private keys are synthetic, publicly committed test
identities. They authorize nothing outside the disposable listener tests.
The CA private keys were discarded after issuance. Certificates expire in
October 2036. Host SANs are localhost and 127.0.0.1; client EKU is clientAuth.
`nac-api` and `wrong-peer` share the trusted CA; `untrusted` uses a different CA.
Tests require both chain validation and the exact nac-api leaf SHA256 pin.

Production CA enrollment, serving/client identity delivery and rotation,
destination/Service/NetworkPolicy and current operation authority are separate
activation inputs. Never install these fixtures in a managed workload.
