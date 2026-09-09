#include <node_api.h>
#include <stdexcept>
#include <string>
#include <vector>
#include <memory>
#include "identity.h"
#include "filesystem.h"

#ifdef _WIN32
std::string MigrateKeyIdentity(const std::string&, const std::string&) {
  // DPAPI is bound to the Windows user, not the application display name.
  return "current";
}
#endif

namespace {
std::string ReadName(napi_env env, napi_value value, size_t maximum = 512) {
  size_t size = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok || size == 0 || size > maximum)
    throw std::runtime_error("Invalid encryption identity.");
  std::vector<char> bytes(size + 1);
  if (napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &size) != napi_ok)
    throw std::runtime_error("Invalid encryption identity.");
  const std::string result(bytes.data(), size);
  if (result.find('\0') != std::string::npos) throw std::runtime_error("Invalid encryption identity.");
  return result;
}

napi_value ReleaseLock(napi_env env, napi_callback_info info) {
  void* data;
  napi_get_cb_info(env, info, nullptr, nullptr, nullptr, &data);
  static_cast<MigrationLock*>(data)->Release();
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value AcquireLock(napi_env env, napi_callback_info info) {
  try {
    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc != 1) throw std::runtime_error("A migration lock path is required.");
    auto lock = std::make_unique<MigrationLock>(ReadName(env, argv[0], 32768));
    napi_value release;
    if (napi_create_function(env, "release", NAPI_AUTO_LENGTH, ReleaseLock, lock.get(), &release) != napi_ok)
      throw std::runtime_error("Could not create migration lock owner.");
    if (napi_add_finalizer(env, release, lock.get(),
      [](napi_env, void* data, void*) { delete static_cast<MigrationLock*>(data); }, nullptr, nullptr) != napi_ok)
      throw std::runtime_error("Could not retain migration lock owner.");
    lock.release();
    return release;
  } catch (const std::exception& error) {
    napi_throw_error(env, "BRAND_MIGRATION_LOCK_FAILED", error.what());
    return nullptr;
  }
}

napi_value RenameDirectory(napi_env env, napi_callback_info info) {
  try {
    size_t argc = 2;
    napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc != 2) throw std::runtime_error("Two migration paths are required.");
    RenameDirectoryNoReplace(ReadName(env, argv[0], 32768), ReadName(env, argv[1], 32768));
    napi_value result;
    napi_get_undefined(env, &result);
    return result;
  } catch (const std::exception& error) {
    napi_throw_error(env, "BRAND_MIGRATION_MOVE_FAILED", error.what());
    return nullptr;
  }
}

napi_value Migrate(napi_env env, napi_callback_info info) {
  try {
    size_t argc = 2;
    napi_value argv[2];
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2)
      throw std::runtime_error("Two encryption identities are required.");
    const auto previous = ReadName(env, argv[0]);
    const auto current = ReadName(env, argv[1]);
    if (previous == current) throw std::runtime_error("Encryption identities must differ.");
    const auto status = MigrateKeyIdentity(previous, current);
    napi_value result;
    napi_create_string_utf8(env, status.c_str(), status.size(), &result);
    return result;
  } catch (const std::exception& error) {
    napi_throw_error(env, "BRAND_KEY_MIGRATION_FAILED", error.what());
    return nullptr;
  }
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value migrate;
  napi_create_function(env, "migrateKeyIdentity", NAPI_AUTO_LENGTH, Migrate, nullptr, &migrate);
  napi_set_named_property(env, exports, "migrateKeyIdentity", migrate);
  napi_value acquire;
  napi_create_function(env, "acquireMigrationLock", NAPI_AUTO_LENGTH, AcquireLock, nullptr, &acquire);
  napi_set_named_property(env, exports, "acquireMigrationLock", acquire);
  napi_value rename;
  napi_create_function(env, "renameDirectoryNoReplace", NAPI_AUTO_LENGTH, RenameDirectory, nullptr, &rename);
  napi_set_named_property(env, exports, "renameDirectoryNoReplace", rename);
  return exports;
}
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
