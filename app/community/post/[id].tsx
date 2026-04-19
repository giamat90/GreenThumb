import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  Modal,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Keyboard,
  Share,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, MoreVertical, Send, Share2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { sendCommunityNotification } from "@/lib/communityNotifications";
import { commentCountUpdates } from "@/lib/communityUpdates";
import {
  REACTIONS, REACTION_ORDER, DEFAULT_REACTION, EMPTY_COUNTS,
  type ReactionType, type ReactionCounts,
} from "@/lib/reactions";
import { ReactionPicker } from "@/components/community/ReactionPicker";
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
  const [currentUserUsername, setCurrentUserUsername] = useState<string | undefined>(undefined);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState({ pageX: 0, pageY: 0, width: 0, height: 0 });
  const reactionBtnRef = useRef<View>(null);
  const flatListRef = useRef<FlatList>(null);
  const preKeyboardOffsetRef = useRef(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardHeightRef = useRef(0);

  // Edit/delete state
  const [editCaptionVisible, setEditCaptionVisible] = useState(false);
  const [editCaptionText, setEditCaptionText] = useState("");
  const [editingComment, setEditingComment] = useState<PostComment | null>(null);
  const [editCommentText, setEditCommentText] = useState("");

  const fetchPost = useCallback(async () => {
    if (!postId || !profile) return;
    setLoading(true);
    try {
      // Fetch post, comments, and like status in parallel.
      // Avoid joining user_profiles directly: posts.user_id has two FKs
      // (auth.users + user_profiles) which causes PostgREST to fail silently.
      // Mirror the enrichment pattern from community.tsx instead.
      const [postResult, commentsResult, reactionResult, reactionCountsResult] = await Promise.all([
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
          .from("post_reactions")
          .select("reaction_type")
          .eq("user_id", profile.id)
          .eq("post_id", postId)
          .maybeSingle(),
        supabase
          .from("post_reaction_counts")
          .select("*")
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

      const resolvedPlantId = row.plant_id as string | null;
      const userReaction = (reactionResult.data as { reaction_type: string } | null)?.reaction_type as ReactionType | null ?? null;
      const rc = reactionCountsResult.data as { sprouting: number; blooming: number; hydrated: number; green_thumb: number } | null;
      const reactionCounts: ReactionCounts = rc
        ? { sprouting: rc.sprouting ?? 0, blooming: rc.blooming ?? 0, hydrated: rc.hydrated ?? 0, green_thumb: rc.green_thumb ?? 0 }
        : { ...EMPTY_COUNTS };
      setPost({
        id: row.id as string,
        user_id: row.user_id as string,
        plant_id: resolvedPlantId,
        photo_url: row.photo_url as string,
        caption: row.caption as string | null,
        likes_count: row.likes_count as number,
        comments_count: row.comments_count as number,
        is_public: row.is_public as boolean,
        created_at: row.created_at as string,
        username: (authorProfile as Record<string, unknown> | null)?.username as string | undefined,
        avatar_url: (authorProfile as Record<string, unknown> | null)?.avatar_url as string | null | undefined,
        plant_name: (row.plants as Record<string, unknown> | null)?.name as string | null | undefined,
        is_liked: !!userReaction,
        user_reaction: userReaction,
        reaction_counts: reactionCounts,
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

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      keyboardHeightRef.current = e.endCoordinates.height;
      setKeyboardHeight(e.endCoordinates.height);
      // scrollToEnd is triggered by FlatList's onLayout once the layout
      // has settled with the new paddingBottom — no delay needed.
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardHeightRef.current = 0;
      setKeyboardHeight(0);
      // Pre-keyboard offset is always valid for the full-height list.
      flatListRef.current?.scrollToOffset({
        offset: preKeyboardOffsetRef.current,
        animated: false,
      });
    });
    return () => { show.remove(); hide.remove(); };
  }, []);

  const handleReact = useCallback(async (type: ReactionType | null) => {
    if (!profile || !post) return;
    const oldReaction = (post.user_reaction as ReactionType | null | undefined) ?? null;
    const oldCounts = post.reaction_counts ?? { ...EMPTY_COUNTS };
    const newCounts = { ...oldCounts };
    if (oldReaction) newCounts[oldReaction] = Math.max(0, newCounts[oldReaction] - 1);
    if (type)         newCounts[type]        = (newCounts[type] ?? 0) + 1;
    setPost((p) => p ? { ...p, user_reaction: type, reaction_counts: newCounts, is_liked: !!type } : p);
    try {
      if (!type) {
        await supabase.from("post_reactions").delete().eq("user_id", profile.id).eq("post_id", post.id);
      } else {
        await supabase.from("post_reactions").upsert(
          { post_id: post.id, user_id: profile.id, reaction_type: type },
          { onConflict: "post_id,user_id" }
        );
        if (!oldReaction) {
          sendCommunityNotification({ type: "like", postId: post.id });
        }
      }
    } catch {
      setPost((p) => p ? { ...p, user_reaction: oldReaction, reaction_counts: oldCounts, is_liked: !!oldReaction } : p);
    }
  }, [profile, post]);

  const handleCaptionMenu = useCallback(() => {
    Alert.alert("", "", [
      { text: t("community.editCaption"), onPress: () => { setEditCaptionText(post?.caption ?? ""); setEditCaptionVisible(true); } },
      { text: t("community.deletePost"), style: "destructive", onPress: () => {
        Alert.alert(t("community.deletePost"), t("community.confirmDeletePost"), [
          { text: t("plantDetail.cancel"), style: "cancel" },
          { text: t("plantDetail.delete"), style: "destructive", onPress: async () => {
            await supabase.from("posts").delete().eq("id", post!.id);
            navigation.goBack();
          }},
        ]);
      }},
      { text: t("plantDetail.cancel"), style: "cancel" },
    ]);
  }, [post, t, navigation]);

  const handleSaveCaption = useCallback(async () => {
    if (!post) return;
    const newCaption = editCaptionText.trim();
    await supabase.from("posts").update({ caption: newCaption }).eq("id", post.id);
    setPost((p) => p ? { ...p, caption: newCaption } : p);
    setEditCaptionVisible(false);
  }, [post, editCaptionText]);

  const handleCommentMenu = useCallback((comment: PostComment) => {
    Alert.alert("", "", [
      { text: t("community.editComment"), onPress: () => { setEditCommentText(comment.content); setEditingComment(comment); } },
      { text: t("community.deleteComment"), style: "destructive", onPress: () => {
        Alert.alert(t("community.deleteComment"), t("community.confirmDeleteComment"), [
          { text: t("plantDetail.cancel"), style: "cancel" },
          { text: t("plantDetail.delete"), style: "destructive", onPress: async () => {
            await supabase.from("post_comments").delete().eq("id", comment.id);
            setComments((prev) => prev.filter((c) => c.id !== comment.id));
            setPost((p) => p ? { ...p, comments_count: Math.max(0, p.comments_count - 1) } : p);
          }},
        ]);
      }},
      { text: t("plantDetail.cancel"), style: "cancel" },
    ]);
  }, [t]);

  const handleSaveComment = useCallback(async () => {
    if (!editingComment) return;
    const newContent = editCommentText.trim();
    if (!newContent) return;
    await supabase.from("post_comments").update({ content: newContent }).eq("id", editingComment.id);
    setComments((prev) => prev.map((c) => c.id === editingComment.id ? { ...c, content: newContent } : c));
    setEditingComment(null);
  }, [editingComment, editCommentText]);

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
    <View style={[styles.screen, { paddingBottom: keyboardHeight }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <FlatList
        ref={flatListRef}
        data={comments}
        keyExtractor={(item) => item.id}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 16 }}
        onScroll={(e) => { preKeyboardOffsetRef.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={100}
        onLayout={() => {
          if (keyboardHeightRef.current > 0) {
            flatListRef.current?.scrollToEnd({ animated: true });
          }
        }}
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
              {/* Reaction button */}
              <View ref={reactionBtnRef} collapsable={false}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => {
                    const cur = (post.user_reaction as ReactionType | null | undefined) ?? null;
                    if (!cur) handleReact(DEFAULT_REACTION);
                    else if (cur === DEFAULT_REACTION) handleReact(null);
                  }}
                  onLongPress={() => {
                    reactionBtnRef.current?.measure((_x, _y, w, h, px, py) => {
                      setPickerAnchor({ pageX: px, pageY: py, width: w, height: h });
                      setPickerVisible(true);
                    });
                  }}
                  delayLongPress={400}
                  activeOpacity={0.7}
                >
                  {(() => {
                    const cur = (post.user_reaction as ReactionType | null | undefined) ?? null;
                    const counts = post.reaction_counts ?? { ...EMPTY_COUNTS };
                    const total = Object.values(counts).reduce((a, b) => a + b, 0);
                    return (
                      <>
                        <Text style={[{ fontSize: 24 }, !cur && { opacity: 0.45 }]}>
                          {cur ? REACTIONS[cur].emoji : REACTIONS.sprouting.emoji}
                        </Text>
                        {total > 0 && (
                          <Text style={[styles.actionCount, !!cur && { color: COLORS.primary, fontWeight: "700" }]}>
                            {total}
                          </Text>
                        )}
                      </>
                    );
                  })()}
                </TouchableOpacity>
              </View>
              {/* Reaction bar */}
              {(() => {
                const counts = post.reaction_counts ?? { ...EMPTY_COUNTS };
                const cur = (post.user_reaction as ReactionType | null | undefined) ?? null;
                return REACTION_ORDER.filter((t) => counts[t] > 0).length > 0 ? (
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                    {REACTION_ORDER.filter((t) => counts[t] > 0).map((t) => (
                      <View key={t} style={{ flexDirection: "row", alignItems: "center", backgroundColor: cur === t ? COLORS.lightgreen : COLORS.cream, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, gap: 2 }}>
                        <Text style={{ fontSize: 12 }}>{REACTIONS[t].emoji}</Text>
                        <Text style={{ fontSize: 11, fontWeight: "600", color: cur === t ? COLORS.primary : COLORS.textSecondary }}>{counts[t]}</Text>
                      </View>
                    ))}
                  </View>
                ) : null;
              })()}
              <ReactionPicker
                visible={pickerVisible}
                anchorPageX={pickerAnchor.pageX}
                anchorPageY={pickerAnchor.pageY}
                anchorWidth={pickerAnchor.width}
                anchorHeight={pickerAnchor.height}
                currentReaction={(post.user_reaction as ReactionType | null | undefined) ?? null}
                onSelect={(type) => {
                  setPickerVisible(false);
                  const cur = (post.user_reaction as ReactionType | null | undefined) ?? null;
                  handleReact(cur === type ? null : type);
                }}
                onDismiss={() => setPickerVisible(false)}
              />

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
                {post.user_id === profile?.id && (
                  <TouchableOpacity onPress={handleCaptionMenu} hitSlop={10} style={styles.moreBtn}>
                    <MoreVertical size={16} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Own post menu when no caption */}
            {!post.caption && post.user_id === profile?.id && (
              <TouchableOpacity onPress={handleCaptionMenu} style={styles.noCaptionMenu}>
                <MoreVertical size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
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
            <View style={styles.commentMain}>
              <Text style={styles.commentUsername}>{item.username ?? "User"} </Text>
              <Text style={styles.commentContent}>{item.content}</Text>
              <Text style={styles.commentTime}>{timeAgo(item.created_at)}</Text>
            </View>
            {item.user_id === profile?.id && (
              <TouchableOpacity onPress={() => handleCommentMenu(item)} hitSlop={10} style={styles.commentMoreBtn}>
                <MoreVertical size={15} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.noComments}>{t("community.commentPlaceholder")}</Text>
        }
      />

      {/* Comment input bar */}
      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
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

      {/* Edit caption modal */}
      <Modal visible={editCaptionVisible} transparent animationType="fade" onRequestClose={() => setEditCaptionVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setEditCaptionVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.editModal} onPress={() => {}}>
            <Text style={styles.editModalTitle}>{t("community.editCaption")}</Text>
            <TextInput
              style={styles.editModalInput}
              value={editCaptionText}
              onChangeText={setEditCaptionText}
              multiline
              autoFocus
              placeholderTextColor={COLORS.textSecondary}
            />
            <TouchableOpacity style={styles.editModalSave} onPress={handleSaveCaption}>
              <Text style={styles.editModalSaveText}>{t("plantDetail.save")}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Edit comment modal */}
      <Modal visible={editingComment !== null} transparent animationType="fade" onRequestClose={() => setEditingComment(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setEditingComment(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.editModal} onPress={() => {}}>
            <Text style={styles.editModalTitle}>{t("community.editComment")}</Text>
            <TextInput
              style={styles.editModalInput}
              value={editCommentText}
              onChangeText={setEditCommentText}
              multiline
              autoFocus
              placeholderTextColor={COLORS.textSecondary}
            />
            <TouchableOpacity style={styles.editModalSave} onPress={handleSaveComment}>
              <Text style={styles.editModalSaveText}>{t("plantDetail.save")}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
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
    alignItems: "flex-start", backgroundColor: "#fff",
  },
  captionUsername: { fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
  captionText: { fontSize: 14, color: COLORS.textPrimary, lineHeight: 20, flex: 1, flexWrap: "wrap" },
  moreBtn: { paddingLeft: 8, paddingTop: 2 },
  noCaptionMenu: { paddingHorizontal: 16, paddingBottom: 8, backgroundColor: "#fff", alignItems: "flex-end" },
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
    flexDirection: "row", alignItems: "flex-start",
  },
  commentMain: { flex: 1 },
  commentMoreBtn: { paddingLeft: 8, paddingTop: 2 },
  commentUsername: { fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
  commentContent: { fontSize: 14, color: COLORS.textPrimary, lineHeight: 20 },
  commentTime: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  noComments: { padding: 20, color: COLORS.textSecondary, textAlign: "center" },
  inputBar: {
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
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  editModal: {
    width: "100%", backgroundColor: "#fff", borderRadius: 16, padding: 20,
  },
  editModalTitle: {
    fontSize: 16, fontWeight: "700", color: COLORS.textPrimary, marginBottom: 12,
  },
  editModalInput: {
    backgroundColor: COLORS.cream, borderRadius: 10, padding: 12,
    fontSize: 14, color: COLORS.textPrimary, minHeight: 80,
    textAlignVertical: "top",
  },
  editModalSave: {
    marginTop: 12, backgroundColor: COLORS.primary, borderRadius: 24,
    paddingVertical: 12, alignItems: "center",
  },
  editModalSaveText: {
    color: "#fff", fontWeight: "700", fontSize: 15,
  },
});
