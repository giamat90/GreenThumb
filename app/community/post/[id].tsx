import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Share,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Heart, Send, Share2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { sendCommunityNotification } from "@/lib/communityNotifications";
import { commentCountUpdates } from "@/lib/communityUpdates";
import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/store/user";
import type { CommunityPost, PostComment } from "@/types";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function PostDetailScreen() {
  const { t } = useTranslation();
  const { id: postId } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { profile } = useUserStore();

  const [post, setPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [inputBarHeight, setInputBarHeight] = useState(0);
  const [currentUserUsername, setCurrentUserUsername] = useState<string | undefined>(undefined);

  const fetchPost = useCallback(async () => {
    if (!postId || !profile) return;
    setLoading(true);
    try {
      // Fetch post, comments, and like status in parallel.
      // Avoid joining user_profiles directly: posts.user_id has two FKs
      // (auth.users + user_profiles) which causes PostgREST to fail silently.
      // Mirror the enrichment pattern from community.tsx instead.
      const [postResult, commentsResult, likeResult] = await Promise.all([
        supabase
          .from("posts")
          .select("*, plants(name)")
          .eq("id", postId)
          .single(),
        supabase
          .from("post_comments")
          .select("*")
          .eq("post_id", postId)
          .order("created_at", { ascending: true }),
        supabase
          .from("post_likes")
          .select("id")
          .eq("user_id", profile.id)
          .eq("post_id", postId)
          .maybeSingle(),
      ]);

      if (!postResult.data) return;
      const row = postResult.data as Record<string, unknown>;

      // Fetch post author profile separately
      const { data: authorProfile } = await supabase
        .from("user_profiles")
        .select("username, avatar_url")
        .eq("id", row.user_id as string)
        .maybeSingle();

      setPost({
        id: row.id as string,
        user_id: row.user_id as string,
        plant_id: row.plant_id as string | null,
        photo_url: row.photo_url as string,
        caption: row.caption as string | null,
        likes_count: row.likes_count as number,
        comments_count: row.comments_count as number,
        is_public: row.is_public as boolean,
        created_at: row.created_at as string,
        username: (authorProfile as Record<string, unknown> | null)?.username as string | undefined,
        avatar_url: (authorProfile as Record<string, unknown> | null)?.avatar_url as string | null | undefined,
        plant_name: (row.plants as Record<string, unknown> | null)?.name as string | null | undefined,
        is_liked: !!likeResult.data,
      });

      // Fetch commenter usernames separately.
      // Always include the current user's ID so their username is available
      // immediately when they submit a new comment (optimistic update).
      const commentRows = (commentsResult.data ?? []) as Record<string, unknown>[];
      const commenterIds = [...new Set([
        ...commentRows.map((c) => c.user_id as string),
        profile.id,
      ])];
      let usernameMap: Record<string, string> = {};
      const { data: commenterProfiles } = await supabase
        .from("user_profiles")
        .select("id, username")
        .in("id", commenterIds);
      if (commenterProfiles) {
        usernameMap = Object.fromEntries(
          (commenterProfiles as Record<string, unknown>[]).map((p) => [p.id as string, p.username as string])
        );
      }
      setCurrentUserUsername(usernameMap[profile.id]);

      setComments(
        commentRows.map((c) => ({
          id: c.id as string,
          user_id: c.user_id as string,
          post_id: c.post_id as string,
          content: c.content as string,
          created_at: c.created_at as string,
          username: usernameMap[c.user_id as string],
        }))
      );
    } catch (err) {
      console.warn("post detail: fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, [postId, profile]);

  useEffect(() => {
    fetchPost();
  }, [fetchPost]);

  const handleLike = useCallback(async () => {
    if (!profile || !post) return;
    const wasLiked = post.is_liked;
    setPost((p) => p ? { ...p, is_liked: !wasLiked, likes_count: p.likes_count + (wasLiked ? -1 : 1) } : p);
    try {
      if (wasLiked) {
        await supabase.from("post_likes").delete().eq("user_id", profile.id).eq("post_id", post.id);
      } else {
        await supabase.from("post_likes").insert({ user_id: profile.id, post_id: post.id });
        sendCommunityNotification({ type: "like", postId: post.id });
      }
    } catch {
      setPost((p) => p ? { ...p, is_liked: wasLiked, likes_count: p.likes_count + (wasLiked ? 1 : -1) } : p);
    }
  }, [profile, post]);

  const handleSubmitComment = useCallback(async () => {
    if (!profile || !post || !commentText.trim()) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("post_comments")
        .insert({ user_id: profile.id, post_id: post.id, content: commentText.trim() })
        .select("*")
        .single();
      if (error) throw error;
      const row = data as Record<string, unknown>;
      const newComment: PostComment = {
        id: row.id as string,
        user_id: row.user_id as string,
        post_id: row.post_id as string,
        content: row.content as string,
        created_at: row.created_at as string,
        username: currentUserUsername,
      };
      setComments((prev) => [...prev, newComment]);
      setPost((p) => p ? { ...p, comments_count: p.comments_count + 1 } : p);
      commentCountUpdates.set(post.id, post.comments_count + 1);
      setCommentText("");
      sendCommunityNotification({ type: "comment", postId: post.id, commentText: commentText.trim() });
    } catch (err) {
      console.warn("post detail: comment failed", err);
    } finally {
      setSubmitting(false);
    }
  }, [profile, post, commentText, currentUserUsername]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  if (!post) return null;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <FlatList
        data={comments}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: inputBarHeight + 16 }}
        ListHeaderComponent={
          <View>
            {/* Back */}
            <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
              <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
                <ArrowLeft size={20} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Photo */}
            <Image source={{ uri: post.photo_url }} style={styles.photo} resizeMode="cover" />

            {/* Actions */}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.actionBtn} onPress={handleLike} activeOpacity={0.7}>
                <Heart
                  size={24}
                  color={post.is_liked ? COLORS.danger : COLORS.textSecondary}
                  fill={post.is_liked ? COLORS.danger : "transparent"}
                />
                <Text style={[styles.actionCount, post.is_liked && { color: COLORS.danger }]}>
                  {post.likes_count}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionBtn}
                onPress={async () => {
                  const shareUrl = `https://uhiyipkjrtqvfvtgerbo.supabase.co/functions/v1/share-post?id=${post.id}`;
                  const message = post.caption
                    ? `${post.caption}\n\n${shareUrl}`
                    : shareUrl;
                  await Share.share({ message });
                }}
                activeOpacity={0.7}
              >
                <Share2 size={24} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Caption */}
            {post.caption && (
              <View style={styles.captionRow}>
                <Text style={styles.captionUsername}>{post.username} </Text>
                <Text style={styles.captionText}>{post.caption}</Text>
              </View>
            )}

            {/* Plant tag */}
            {post.plant_name && (
              <Text style={styles.plantTag}>{t("community.plantTag", { name: post.plant_name })}</Text>
            )}

            <Text style={styles.commentsHeader}>{t("community.comments")}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.commentRow}>
            <Text style={styles.commentUsername}>{item.username ?? "User"} </Text>
            <Text style={styles.commentContent}>{item.content}</Text>
            <Text style={styles.commentTime}>{timeAgo(item.created_at)}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.noComments}>{t("community.commentPlaceholder")}</Text>
        }
      />

      {/* Comment input bar */}
      <View
        style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}
        onLayout={(e) => setInputBarHeight(e.nativeEvent.layout.height)}
      >
        <TextInput
          style={styles.input}
          value={commentText}
          onChangeText={setCommentText}
          placeholder={t("community.commentPlaceholder")}
          placeholderTextColor={COLORS.textSecondary}
          multiline={false}
          returnKeyType="send"
          onSubmitEditing={handleSubmitComment}
        />
        <TouchableOpacity
          onPress={handleSubmitComment}
          disabled={submitting || !commentText.trim()}
          style={styles.sendBtn}
        >
          {submitting ? (
            <ActivityIndicator color={COLORS.primary} size="small" />
          ) : (
            <Send size={20} color={commentText.trim() ? COLORS.primary : COLORS.textSecondary} />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.cream },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.cream },
  topBar: {
    paddingHorizontal: 16, paddingBottom: 8, backgroundColor: "#fff",
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.cream, alignItems: "center", justifyContent: "center",
  },
  photo: { width: "100%", aspectRatio: 1, backgroundColor: "#E5E7EB" },
  actions: {
    flexDirection: "row", padding: 12, gap: 16, backgroundColor: "#fff",
  },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionCount: { fontSize: 14, fontWeight: "600", color: COLORS.textSecondary },
  captionRow: {
    paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row",
    flexWrap: "wrap", backgroundColor: "#fff",
  },
  captionUsername: { fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
  captionText: { fontSize: 14, color: COLORS.textPrimary, lineHeight: 20, flex: 1 },
  plantTag: {
    paddingHorizontal: 16, paddingBottom: 12,
    fontSize: 13, color: COLORS.secondary, backgroundColor: "#fff",
  },
  commentsHeader: {
    paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 14, fontWeight: "700", color: COLORS.textSecondary,
    borderTopWidth: 1, borderTopColor: "#EFEFEF",
  },
  commentRow: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#F3F4F6",
  },
  commentUsername: { fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
  commentContent: { fontSize: 14, color: COLORS.textPrimary, lineHeight: 20 },
  commentTime: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  noComments: { padding: 20, color: COLORS.textSecondary, textAlign: "center" },
  inputBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#fff", paddingTop: 8, paddingHorizontal: 16,
    borderTopWidth: 1, borderTopColor: "#EFEFEF",
    flexDirection: "row", alignItems: "center", gap: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 5,
  },
  input: {
    flex: 1, backgroundColor: COLORS.cream, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 14, color: COLORS.textPrimary,
  },
  sendBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
