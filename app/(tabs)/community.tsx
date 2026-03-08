import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Alert,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Heart, MessageCircle, Plus, Users } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/store/user";
import { useProGate } from "@/hooks/useProGate";
import type { CommunityPost } from "@/types";

const PAGE_SIZE = 20;

function timeAgo(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return t("community.justNow");
  if (mins < 60) return t("community.ago", { n: mins, unit: "m" });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("community.ago", { n: hours, unit: "h" });
  const days = Math.floor(hours / 24);
  return t("community.ago", { n: days, unit: "d" });
}

function UserAvatar({ username, avatarUrl, size = 36 }: { username?: string; avatarUrl?: string | null; size?: number }) {
  const initials = username ? username.slice(0, 2).toUpperCase() : "?";
  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  return (
    <View style={[styles.avatarPlaceholder, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.35 }]}>{initials}</Text>
    </View>
  );
}

function PostCard({
  post,
  currentUserId,
  onLike,
  onComment,
  onProfile,
}: {
  post: CommunityPost;
  currentUserId: string;
  onLike: (postId: string, isLiked: boolean) => void;
  onComment: (postId: string) => void;
  onProfile: (userId: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const caption = post.caption ?? "";
  const isLong = caption.length > 120;
  const displayCaption = !isLong || expanded ? caption : caption.slice(0, 120) + "…";

  return (
    <View style={styles.postCard}>
      {/* Header */}
      <TouchableOpacity
        style={styles.postHeader}
        onPress={() => onProfile(post.user_id)}
        activeOpacity={0.7}
      >
        <UserAvatar username={post.username} avatarUrl={post.avatar_url} />
        <View style={styles.postHeaderInfo}>
          <Text style={styles.postUsername}>{post.username ?? t("community.postedBy")}</Text>
          {post.plant_name && (
            <Text style={styles.plantTag}>{t("community.plantTag", { name: post.plant_name })}</Text>
          )}
        </View>
        <Text style={styles.postTime}>{timeAgo(post.created_at, t)}</Text>
      </TouchableOpacity>

      {/* Photo */}
      <Image
        source={{ uri: post.photo_url }}
        style={styles.postPhoto}
        resizeMode="cover"
      />

      {/* Actions */}
      <View style={styles.postActions}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => onLike(post.id, !!post.is_liked)}
          activeOpacity={0.7}
        >
          <Heart
            size={22}
            color={post.is_liked ? COLORS.danger : COLORS.textSecondary}
            fill={post.is_liked ? COLORS.danger : "transparent"}
          />
          <Text style={[styles.actionCount, post.is_liked && styles.actionCountLiked]}>
            {post.likes_count}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => onComment(post.id)}
          activeOpacity={0.7}
        >
          <MessageCircle size={22} color={COLORS.textSecondary} />
          <Text style={styles.actionCount}>{post.comments_count}</Text>
        </TouchableOpacity>
      </View>

      {/* Caption */}
      {caption.length > 0 && (
        <View style={styles.captionContainer}>
          <Text style={styles.captionText}>
            {displayCaption}
            {isLong && !expanded && (
              <Text style={styles.expandText} onPress={() => setExpanded(true)}>
                {" "}{t("community.tapToExpand")}
              </Text>
            )}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function CommunityScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useUserStore();
  const { isPro, showPaywall } = useProGate();

  const [activeTab, setActiveTab] = useState<"discover" | "following">("discover");
  const [discoverPosts, setDiscoverPosts] = useState<CommunityPost[]>([]);
  const [followingPosts, setFollowingPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(0);

  const posts = activeTab === "discover" ? discoverPosts : followingPosts;
  const setPosts = activeTab === "discover" ? setDiscoverPosts : setFollowingPosts;

  const fetchPosts = useCallback(async (reset = false) => {
    if (!profile) return;
    if (reset) {
      pageRef.current = 0;
      setHasMore(true);
    }
    setLoading(true);
    try {
      const offset = pageRef.current * PAGE_SIZE;

      // Get liked post IDs for current user
      const { data: likedData } = await supabase
        .from("post_likes")
        .select("post_id")
        .eq("user_id", profile.id);
      const likedIds = new Set((likedData ?? []).map((l: { post_id: string }) => l.post_id));

      let query = supabase
        .from("posts")
        .select("*, user_profiles(username, avatar_url), plants(name)")
        .eq("is_public", true)
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (activeTab === "following") {
        // Get followed user IDs
        const { data: followData } = await supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", profile.id);
        const followedIds = (followData ?? []).map((f: { following_id: string }) => f.following_id);
        if (followedIds.length === 0) {
          setPosts(reset ? [] : (prev) => prev);
          setLoading(false);
          return;
        }
        query = query.in("user_id", followedIds);
      }

      const { data, error } = await query;
      if (error) throw error;

      const mapped: CommunityPost[] = (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        user_id: row.user_id as string,
        plant_id: row.plant_id as string | null,
        photo_url: row.photo_url as string,
        caption: row.caption as string | null,
        likes_count: row.likes_count as number,
        comments_count: row.comments_count as number,
        is_public: row.is_public as boolean,
        created_at: row.created_at as string,
        username: (row.user_profiles as Record<string, unknown> | null)?.username as string | undefined,
        avatar_url: (row.user_profiles as Record<string, unknown> | null)?.avatar_url as string | null | undefined,
        plant_name: (row.plants as Record<string, unknown> | null)?.name as string | null | undefined,
        is_liked: likedIds.has(row.id as string),
      }));

      if (reset) {
        setPosts(mapped);
      } else {
        setPosts((prev) => [...prev, ...mapped]);
      }
      setHasMore(mapped.length === PAGE_SIZE);
      pageRef.current += 1;
    } catch (err) {
      console.warn("community: fetch posts failed", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(
    useCallback(() => {
      fetchPosts(true);
    }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPosts(true);
  }, [fetchPosts]);

  const handleLoadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchPosts(false);
    }
  }, [loading, hasMore, fetchPosts]);

  const handleLike = useCallback(async (postId: string, isLiked: boolean) => {
    if (!profile) return;
    // Optimistic update
    const updatePost = (prev: CommunityPost[]) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, is_liked: !isLiked, likes_count: p.likes_count + (isLiked ? -1 : 1) }
          : p
      );
    if (activeTab === "discover") setDiscoverPosts(updatePost);
    else setFollowingPosts(updatePost);

    try {
      if (isLiked) {
        await supabase.from("post_likes").delete().eq("user_id", profile.id).eq("post_id", postId);
      } else {
        await supabase.from("post_likes").insert({ user_id: profile.id, post_id: postId });
      }
    } catch {
      // Revert on error
      const revert = (prev: CommunityPost[]) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, is_liked: isLiked, likes_count: p.likes_count + (isLiked ? 1 : -1) }
            : p
        );
      if (activeTab === "discover") setDiscoverPosts(revert);
      else setFollowingPosts(revert);
    }
  }, [profile, activeTab]);

  const handleComment = useCallback((postId: string) => {
    router.push({ pathname: "/community/post/[id]", params: { id: postId } });
  }, [router]);

  const handleProfile = useCallback((userId: string) => {
    router.push({ pathname: "/community/profile/[id]", params: { id: userId } });
  }, [router]);

  const handleNewPost = useCallback(() => {
    if (!isPro) {
      Alert.alert(t("community.sharePost"), t("community.proFeaturePost"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("paywall.greenThumbPro"), onPress: showPaywall },
      ]);
      return;
    }
    router.push("/community/new-post");
  }, [isPro, showPaywall, router, t]);

  const [fabHeight, setFabHeight] = useState(0);

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>{t("community.tab")}</Text>

        {/* Sub-tabs */}
        <View style={styles.subTabs}>
          <TouchableOpacity
            style={[styles.subTab, activeTab === "discover" && styles.subTabActive]}
            onPress={() => setActiveTab("discover")}
          >
            <Text style={[styles.subTabText, activeTab === "discover" && styles.subTabTextActive]}>
              {t("community.discover")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.subTab, activeTab === "following" && styles.subTabActive]}
            onPress={() => setActiveTab("following")}
          >
            <Text style={[styles.subTabText, activeTab === "following" && styles.subTabTextActive]}>
              {t("community.following")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Feed */}
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            currentUserId={profile?.id ?? ""}
            onLike={handleLike}
            onComment={handleComment}
            onProfile={handleProfile}
          />
        )}
        contentContainerStyle={{ paddingBottom: fabHeight + 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Users size={48} color={COLORS.textSecondary} />
              <Text style={styles.emptyTitle}>
                {activeTab === "discover" ? t("community.noPostsYet") : t("community.followSomeone")}
              </Text>
              <Text style={styles.emptySubtitle}>
                {activeTab === "discover" ? t("community.beFirstToPost") : t("community.noFollowingPosts")}
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={loading && posts.length > 0 ? <ActivityIndicator color={COLORS.primary} style={{ padding: 20 }} /> : null}
      />

      {/* FAB */}
      <View
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
        onLayout={(e) => setFabHeight(e.nativeEvent.layout.height + 24 + insets.bottom)}
      >
        <TouchableOpacity
          style={styles.fabButton}
          onPress={handleNewPost}
          activeOpacity={0.85}
          accessibilityLabel={t("community.sharePost")}
          accessibilityRole="button"
        >
          <Plus size={26} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.cream },
  header: {
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingBottom: 0,
    borderBottomWidth: 1,
    borderBottomColor: "#EFEFEF",
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.primary,
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  subTabs: {
    flexDirection: "row",
    gap: 4,
  },
  subTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  subTabActive: {
    borderBottomColor: COLORS.primary,
  },
  subTabText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  subTabTextActive: {
    color: COLORS.primary,
  },

  // Post card
  postCard: {
    backgroundColor: "#fff",
    marginHorizontal: 0,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  postHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 10,
  },
  postHeaderInfo: { flex: 1 },
  postUsername: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  plantTag: {
    fontSize: 12,
    color: COLORS.secondary,
    marginTop: 1,
  },
  postTime: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  postPhoto: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: "#E5E7EB",
  },
  postActions: {
    flexDirection: "row",
    padding: 12,
    gap: 16,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  actionCount: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: "600",
  },
  actionCountLiked: {
    color: COLORS.danger,
  },
  captionContainer: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  captionText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    lineHeight: 20,
  },
  expandText: {
    color: COLORS.secondary,
    fontWeight: "600",
  },

  // Avatar
  avatarPlaceholder: {
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontWeight: "700",
    color: COLORS.primary,
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },

  // FAB
  fab: {
    position: "absolute",
    right: 20,
  },
  fabButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});
