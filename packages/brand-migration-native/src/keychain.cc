#include "identity.h"
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <memory>
#include <stdexcept>

namespace {
struct Release {
  void operator()(const void* value) const { if (value) CFRelease(value); }
};
template <typename T> using Owned = std::unique_ptr<const T, Release>;

Owned<__CFArray> Find(const std::string& name) {
  const auto service_name = name + " Safe Storage";
  Owned<__CFString> service(CFStringCreateWithBytes(nullptr,
    reinterpret_cast<const UInt8*>(service_name.data()), service_name.size(), kCFStringEncodingUTF8, false));
  Owned<__CFString> account(CFStringCreateWithBytes(nullptr,
    reinterpret_cast<const UInt8*>(name.data()), name.size(), kCFStringEncodingUTF8, false));
  const void* keys[] = {kSecClass, kSecAttrService, kSecAttrAccount, kSecReturnRef, kSecMatchLimit};
  const void* values[] = {kSecClassGenericPassword, service.get(), account.get(), kCFBooleanTrue, kSecMatchLimitAll};
  Owned<__CFDictionary> query(CFDictionaryCreate(nullptr, keys, values, 5,
    &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks));
  CFTypeRef result = nullptr;
  const auto status = SecItemCopyMatching(query.get(), &result);
  if (status == errSecItemNotFound) return Owned<__CFArray>(nullptr);
  if (status != errSecSuccess) {
    if (result) CFRelease(result);
    throw std::runtime_error("Could not inspect encryption identity; Keychain status " + std::to_string(status) + ".");
  }
  if (!result || CFGetTypeID(result) != CFArrayGetTypeID()) {
    if (result) CFRelease(result);
    throw std::runtime_error("Invalid Keychain identity response.");
  }
  return Owned<__CFArray>(static_cast<CFArrayRef>(result));
}
CFIndex Count(const Owned<__CFArray>& items) { return items ? CFArrayGetCount(items.get()) : 0; }
}

std::string MigrateKeyIdentity(const std::string& previous_name, const std::string& current_name) {
  const auto previous = Find(previous_name);
  const auto current = Find(current_name);
  if (Count(previous) > 1 || Count(current) > 1)
    throw std::runtime_error("Multiple encryption keys exist for one identity. Migration requires conflict resolution.");
  if (Count(previous) == 0) return Count(current) == 0 ? "absent" : "current";
  if (Count(current) != 0)
    throw std::runtime_error("Both encryption identities already have keys. Neither key was changed.");

  // Update the exact item reference, retaining its secret, access control, and owning keychain.
  // Passing null data explicitly preserves its password; no key material reaches JavaScript,
  // a child process, environment variable, log, or temporary file.
  const auto service = current_name + " Safe Storage";
  SecKeychainAttribute attributes[] = {
    {kSecServiceItemAttr, static_cast<UInt32>(service.size()), const_cast<char*>(service.data())},
    {kSecAccountItemAttr, static_cast<UInt32>(current_name.size()), const_cast<char*>(current_name.data())},
    {kSecLabelItemAttr, static_cast<UInt32>(service.size()), const_cast<char*>(service.data())}
  };
  SecKeychainAttributeList list = {3, attributes};
  auto item = static_cast<SecKeychainItemRef>(const_cast<void*>(CFArrayGetValueAtIndex(previous.get(), 0)));
  const auto status = SecKeychainItemModifyAttributesAndData(item, &list, 0, nullptr);
  if (status != errSecSuccess)
    throw std::runtime_error("Could not migrate encryption identity; Keychain status " + std::to_string(status) + ".");
  if (Count(Find(previous_name)) != 0 || Count(Find(current_name)) != 1)
    throw std::runtime_error("Encryption identity changed but verification failed. Retry migration before starting the application.");
  return "migrated";
}
