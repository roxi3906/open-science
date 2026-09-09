{
  "targets": [{
    "target_name": "brand_migration_native",
    "sources": ["src/binding.cc", "src/filesystem.cc"],
    "defines": ["NAPI_VERSION=8"],
    "conditions": [
      ["OS=='mac'", {"sources": ["src/keychain.cc"], "libraries": ["-framework Security", "-framework CoreFoundation"]}],
      ["OS=='linux'", {"sources": ["src/libsecret.cc"], "libraries": ["-ldl"]}],
      ["OS=='win'", {"msvs_settings": {"VCCLCompilerTool": {"AdditionalOptions": ["/std:c++17", "/EHsc"]}}}],
      ["OS!='win'", {"cflags_cc": ["-std=c++17", "-fexceptions"], "cflags_cc!": ["-fno-exceptions"], "xcode_settings": {"GCC_ENABLE_CPP_EXCEPTIONS": "YES", "CLANG_CXX_LANGUAGE_STANDARD": "c++17"}}]
    ]
  }]
}
