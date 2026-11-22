# Incident playground

Each packaged run copies this directory into a temporary workspace. The baseline has `status=broken`. Run `node --test` from the playground to see its intentional failure. Changing the incident to include the exact line `status=fixed` makes it pass.

The offline scenarios use this same real test. A false claim leaves the baseline unchanged. A simulated fix changes the copy. A simulated agent failure starts with a passing copy to show why an execution failure still affects the verdict.
