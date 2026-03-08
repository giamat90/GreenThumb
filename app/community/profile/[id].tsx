import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/store/user";
import type { CommunityPost, UserProfile } from "@/types";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const GRID_ITEM_SIZE = (SCREEN_WIDTH - 4) / 3;

export default function PublicProfileScreen() {
  const { t } = useTranslation();
  const { id: userId } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile: currentProfile } = useUserStore();

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);

  const isOwnProfile = userId === currentProfile?.id;

  const fetchProfile = useCallback(async () => {
    if (!userId || !currentProfile) return;
    setLoading(true);
    try {
      const [profileResult, postsResult, followResult] = await Promise.all([
        supabase.from("user_profiles").select("*").eq("id", userId).maybeSingle(),
        supabase
          .from("posts")
          .select("id, photo_url, likes_count, comments_count, created_at")
          .eq("user_id", userId)
          .eq("is_public", true)
          .order("created_at", { ascending: false }),
        supabase
          .from("follows")
          .select("id")
          .eq("follower_id", currentProfile.id)
          .eq("following_id", userId)
          .maybeSingle(),
      ]);

      if (profileResult.data) {
        setUserProfile(profileResult.data as UserProfile);
      }

      const mappedPosts: CommunityPost[] = (postsResult.data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        user_id: userId,
        plant_id: null,
        photo_url: row.photo_url as string,
        caption: null,
        likes_count: row.likes_count as number,
        comments_count: row.comments_count as number,
        is_public: true,
        created_at: row.created_at as string,
      }));
      setPosts(mappedPosts);
      setIsFollowing(!!followResult.data);
    } catch (err) {
      console.warn("profile: fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, [userId, currentProfile]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleFollow = useCallback(async () => {
    if (!currentProfile || !userId) return;
    setFollowLoading(true);
    const wasFollowing = isFollowing;
    setIsFollowing(!wasFollowing);
    try {
      if (wasFollowing) {
        await supabase.from("follows").delete().eq("follower_id", currentProfile.id).eq("following_id", userId);
      } else {
        await supabase.from("follows").insert({ follower_id: currentProfile.id, following_id: userId });
      }
    } catch {
      setIsFollowing(wasFollowing);
    } finally {
      setFollowLoading(false);
    }
  }, [currentProfile, userId, isFollowing]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  const username = userProfile?.username ?? "User";
  const postCount = posts.length;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={{ gap: 2 }}
        ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
        ListHeaderComponent={
          <View>
            {/* Top bar */}
            <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
              <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
                <ArrowLeft size={20} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Profile info */}
            <View style={styles.profileSection}>
              {/* Avatar */}
              {userProfile?.avatar_url ? (
                <Image source={{ uri: userProfile.avatar_url }} style={styles.avatarLarge} />
              ) : (
                <View style={styles.avatarLarge}>
                  <Text style={styles.avatarInitials}>{username.slice(0, 2).toUpperCase()}</Text>
                </View>
              )}

              <Text style={styles.username}>{username}</Text>
              {userProfile?.bio && <Text style={styles.bio}>{userProfile.bio}</Text>}

              {/* Stats */}
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{postCount}</Text>
                  <Text style={styles.statLabel}>{t("community.posts")}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{userProfile?.followers_count ?? 0}</Text>
                  <Text style={styles.statLabel}>{t("community.followers")}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{userProfile?.following_count ?? 0}</Text>
                  <Text style={styles.statLabel}>{t("community.followingCount")}</Text>
                </View>
              </View>

              {/* Follow button */}
              {!isOwnProfile && (
                <TouchableOpacity
                  style={[styles.followBtn, isFollowing && styles.followingBtn]}
                  onPress={handleFollow}
                  disabled={followLoading}
                  activeOpacity={0.85}
                >
                  {followLoading ? (
                    <ActivityIndicator color={isFollowing ? COLORS.primary : "#fff"} size="small" />
                  ) : (
                    <Text style={[styles.followBtnText, isFollowing && styles.followingBtnText]}>
                      {isFollowing ? t("community.unfollow") : t("community.follow")}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>

            {/* Divider */}
            <View style={styles.divider} />
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push({ pathname: "/community/post/[id]", params: { id: item.id } })}
            activeOpacity={0.85}
          >
            <Image
              source={{ uri: item.photo_url }}
              style={{ width: GRID_ITEM_SIZE, height: GRID_ITEM_SIZE, backgroundColor: "#E5E7EB" }}
              resizeMode="cover"
            />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyGrid}>
            <Text style={styles.emptyText}>{t("community.noPostsYet")}</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.cream },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.cream },
  topBar: { paddingHorizontal: 16, paddingBottom: 8, backgroundColor: "#fff" },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.cream, alignItems: "center", justifyContent: "center",
  },
  profileSection: {
    backgroundColor: "#fff", paddingHorizontal: 20, paddingBottom: 24,
    alignItems: "center", gap: 10,
  },
  avatarLarge: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center", justifyContent: "center",
  },
  avatarInitials: { fontSize: 28, fontWeight: "700", color: COLORS.primary },
  username: { fontSize: 20, fontWeight: "800", color: COLORS.textPrimary },
  bio: { fontSize: 14, color: COLORS.textSecondary, textAlign: "center", lineHeight: 20 },
  statsRow: { flexDirection: "row", gap: 32, marginTop: 8 },
  stat: { alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontWeight: "800", color: COLORS.textPrimary },
  statLabel: { fontSize: 12, color: COLORS.textSecondary },
  followBtn: {
    backgroundColor: COLORS.primary, borderRadius: 12,
    paddingHorizontal: 32, paddingVertical: 10, marginTop: 8,
  },
  followingBtn: {
    backgroundColor: "transparent", borderWidth: 1.5, borderColor: COLORS.primary,
  },
  followBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  followingBtnText: { color: COLORS.primary },
  divider: { height: 1, backgroundColor: "#EFEFEF", marginTop: 8 },
  emptyGrid: { padding: 40, alignItems: "center" },
  emptyText: { fontSize: 15, color: COLORS.textSecondary },
});
