import React from "react";
import { View, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";

// Bundled asset — Biesiada pod lasem, wieczorne przyjęcie
const BG = require("../../assets/images/bg.jpg");

/**
 * Fixed background image with a strong dark overlay used across the app.
 * Rendered once inside RootLayout below the router content.
 * Content on top uses transparent backgrounds so the image shows through.
 */
export default function AppBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Image source={BG} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      <LinearGradient
        colors={[
          "rgba(12,12,14,0.55)",
          "rgba(12,12,14,0.75)",
          "rgba(12,12,14,0.9)",
        ]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
