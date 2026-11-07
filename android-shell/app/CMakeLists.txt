cmake_minimum_required(VERSION 3.22.1)
project(xunxin_node)
include_directories(${CMAKE_SOURCE_DIR}/libnode/include/node)
add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION ${CMAKE_SOURCE_DIR}/libnode/bin/${ANDROID_ABI}/libnode.so)
add_library(xunxin_node SHARED src/main/cpp/xunxin-node.cpp)
target_compile_features(xunxin_node PRIVATE cxx_std_20)
target_link_options(xunxin_node PRIVATE
    "-Wl,-z,max-page-size=16384"
    "-Wl,-z,common-page-size=16384")
target_link_libraries(xunxin_node node log)
