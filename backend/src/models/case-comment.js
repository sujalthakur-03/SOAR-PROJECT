/**
 * CaseComment Model
 * Tracks comments and notes added to cases by analysts
 *
 * Provides a separate collection for case comments to enable:
 * - Efficient comment querying and pagination
 * - Rich comment metadata (attachments, mentions, etc.)
 * - Comment-specific operations (edit, delete, reactions)
 */

import mongoose from 'mongoose';

const caseCommentSchema = new mongoose.Schema({
  // Reference to parent case
  case_id: {
    type: String,
    required: true,
    index: true
  },

  // Comment content
  content: {
    type: String,
    required: true
  },

  // Comment type
  comment_type: {
    type: String,
    enum: ['note', 'update', 'analysis', 'resolution', 'internal', 'external'],
    default: 'note'
  },

  // Author information
  author: {
    type: String,
    required: true,
    index: true
  },

  // Visibility
  visibility: {
    type: String,
    enum: ['internal', 'external', 'restricted'],
    default: 'internal'
  },

  // Metadata for rich comments
  metadata: {
    mentions: [String], // @mentioned users
    attachments: [{
      name: String,
      type: String,
      url: String,
      size: Number
    }],
    tags: [String],
    parent_comment_id: String, // For threaded comments
    edited: {
      type: Boolean,
      default: false
    },
    edit_history: [{
      edited_at: Date,
      edited_by: String,
      previous_content: String
    }]
  },

  // Deletion tracking (soft delete)
  deleted: {
    type: Boolean,
    default: false
  },
  deleted_at: Date,
  deleted_by: String
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

// ============================================================================
// INDEXES
// ============================================================================

// Case comments sorted by time
caseCommentSchema.index(
  { case_id: 1, created_at: -1 },
  { name: 'idx_case_created', background: true }
);

// Author filtering
caseCommentSchema.index(
  { author: 1, created_at: -1 },
  { name: 'idx_author_created', background: true }
);

// Comment type filtering
caseCommentSchema.index(
  { case_id: 1, comment_type: 1, created_at: -1 },
  { name: 'idx_case_type_created', background: true }
);

// Exclude deleted comments
caseCommentSchema.index(
  { deleted: 1 },
  { name: 'idx_deleted', background: true }
);

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Edit comment with history tracking
 */
caseCommentSchema.methods.edit = function(newContent, editedBy) {
  if (!this.metadata) {
    this.metadata = {};
  }
  if (!this.metadata.edit_history) {
    this.metadata.edit_history = [];
  }

  // Save previous content to history
  this.metadata.edit_history.push({
    edited_at: new Date(),
    edited_by: editedBy,
    previous_content: this.content
  });

  this.content = newContent;
  this.metadata.edited = true;

  return this.save();
};

/**
 * Soft delete comment
 */
caseCommentSchema.methods.softDelete = function(deletedBy) {
  this.deleted = true;
  this.deleted_at = new Date();
  this.deleted_by = deletedBy;
  return this.save();
};

const CaseComment = mongoose.model('CaseComment', caseCommentSchema);

export default CaseComment;
