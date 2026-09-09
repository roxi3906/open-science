#include "identity.h"
#include <dlfcn.h>
#include <memory>
#include <stdexcept>

namespace {
// Opaque GLib/libsecret handles and their stable public C ABI. Loading at runtime avoids requiring
// libsecret development headers on a packaging host or linking it on KWallet-only installations.
struct Error;
struct Table;
struct List { void* data; List* next; List* previous; };
using Hash = unsigned int (*)(const void*);
using Equal = int (*)(const void*, const void*);
using Destroy = void (*)(void*);

class Api {
 public:
  void* library;
  template <typename T> T Load(const char* name) {
    auto value = reinterpret_cast<T>(dlsym(library, name));
    if (!value) throw std::runtime_error("The installed Secret Service library is incompatible with migration.");
    return value;
  }
  Api() : library(dlopen("libsecret-1.so.0", RTLD_NOW | RTLD_LOCAL)) {
    if (!library) throw std::runtime_error("Secret Service is unavailable. Encryption identity was not changed.");
  }
  ~Api() { dlclose(library); }
  Api(const Api&) = delete;
  Api& operator=(const Api&) = delete;
};

class Store {
  Api api;
 public:
  Hash hash = api.Load<Hash>("g_str_hash");
  Equal equal = api.Load<Equal>("g_str_equal");
  Table* (*new_table)(Hash, Equal) = api.Load<decltype(new_table)>("g_hash_table_new");
  int (*insert)(Table*, void*, void*) = api.Load<decltype(insert)>("g_hash_table_insert");
  int (*replace)(Table*, void*, void*) = api.Load<decltype(replace)>("g_hash_table_replace");
  void (*unref_table)(Table*) = api.Load<decltype(unref_table)>("g_hash_table_unref");
  char* (*duplicate)(const char*) = api.Load<decltype(duplicate)>("g_strdup");
  void (*free_error)(Error*) = api.Load<decltype(free_error)>("g_error_free");
  void (*unref_object)(void*) = api.Load<decltype(unref_object)>("g_object_unref");
  void (*free_list)(List*, Destroy) = api.Load<decltype(free_list)>("g_list_free_full");
  List* (*search)(void*, const void*, Table*, int, void*, Error**) =
    api.Load<decltype(search)>("secret_service_search_sync");
  Table* (*get_attributes)(void*) = api.Load<decltype(get_attributes)>("secret_item_get_attributes");
  int (*set_attributes)(void*, const void*, Table*, void*, Error**) =
    api.Load<decltype(set_attributes)>("secret_item_set_attributes_sync");
  int (*is_locked)(void*) = api.Load<decltype(is_locked)>("secret_item_get_locked");

  void Check(Error* error) {
    if (!error) return;
    free_error(error);
    // Do not copy daemon-provided error payloads into application logs.
    throw std::runtime_error("Secret Service rejected encryption identity migration. Unlock it and retry.");
  }
};

struct Items {
  Store& store;
  List* list;
  ~Items() { if (list) store.free_list(list, store.unref_object); }
  Items(const Items&) = delete;
  Items(Store& store, List* list) : store(store), list(list) {}
  int Count() const { return !list ? 0 : list->next ? 2 : 1; }
};

Items Find(Store& store, const std::string& name) {
  std::unique_ptr<Table, decltype(store.unref_table)> attributes(
    store.new_table(store.hash, store.equal), store.unref_table);
  store.insert(attributes.get(), const_cast<char*>("application"), const_cast<char*>(name.c_str()));
  Error* error = nullptr;
  // All matches, unlocking if necessary, without loading any secret values.
  auto* result = store.search(nullptr, nullptr, attributes.get(), (1 << 1) | (1 << 2), nullptr, &error);
  Items items(store, result);
  store.Check(error);
  if (result && store.is_locked(result->data))
    throw std::runtime_error("The encryption key is locked. Identity was not changed.");
  // C++17 guaranteed elision; the local list's ownership is transferred explicitly.
  items.list = nullptr;
  return Items(store, result);
}
}

std::string MigrateKeyIdentity(const std::string& previous_name, const std::string& current_name) {
  Store store;
  const auto previous = Find(store, previous_name);
  const auto current = Find(store, current_name);
  if (previous.Count() > 1 || current.Count() > 1)
    throw std::runtime_error("Multiple encryption keys exist for one identity. Migration requires conflict resolution.");
  if (previous.Count() == 0) return current.Count() == 0 ? "absent" : "current";
  if (current.Count() != 0)
    throw std::runtime_error("Both encryption identities already have keys. Neither key was changed.");
  auto* item = previous.list->data;
  std::unique_ptr<Table, decltype(store.unref_table)> attributes(
    store.get_attributes(item), store.unref_table);
  if (!attributes) throw std::runtime_error("Could not inspect encryption key attributes.");
  store.replace(attributes.get(), store.duplicate("application"), store.duplicate(current_name.c_str()));
  Error* error = nullptr;
  const bool changed = store.set_attributes(item, nullptr, attributes.get(), nullptr, &error);
  store.Check(error);
  if (!changed) throw std::runtime_error("Could not migrate encryption identity.");
  if (Find(store, previous_name).Count() != 0 || Find(store, current_name).Count() != 1)
    throw std::runtime_error("Encryption identity changed but verification failed. Retry before application startup.");
  return "migrated";
}
