#pragma once

#include <string>

// The secret never crosses the native boundary. Implementations modify lookup attributes only.
std::string MigrateKeyIdentity(const std::string& previous_name, const std::string& current_name);
